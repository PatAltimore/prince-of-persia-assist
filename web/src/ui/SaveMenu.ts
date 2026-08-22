import { Apple2 } from 'js/apple2';
import { captureSnapshot, restoreSnapshot } from '../emulator/snapshot/SnapshotSerializer';
import { saveGame, loadSave, deleteSave, listSaves, SaveMeta } from '../emulator/snapshot/SaveGameStore';

export interface SaveMenuElements {
    saveBtn: HTMLButtonElement;
    loadBtn: HTMLButtonElement;
    saveDialog: HTMLDialogElement;
    saveForm: HTMLFormElement;
    saveNameInput: HTMLInputElement;
    saveError: HTMLElement;
    saveCancelBtn: HTMLButtonElement;
    loadDialog: HTMLDialogElement;
    loadList: HTMLUListElement;
    loadEmpty: HTMLElement;
    loadCancelBtn: HTMLButtonElement;
}

// `.toLocaleString(locale, options)` formats a date/time the way a human
// in a given locale (region/language) would expect to see it, rather than
// a raw timestamp or a fixed format — passing `undefined` for the locale
// tells it "use whatever locale the browser/OS is already configured
// for," so a save made in a US-English browser might show "Jan 5, 2026,
// 3:45 PM" while the same code in a different locale would format it
// differently, all without this code needing to know anything about
// locale-specific date conventions itself.
function formatSavedAt(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

/**
 * Wires the Save/Load dialogs to the multi-save localStorage store
 * (SaveGameStore.ts). Both dialogs refocus the game canvas on close
 * (including ESC-dismissal, via the native `close` event, not just our own
 * button handlers) — see attachRewindScrubber's doc comment in
 * RewindScrubber.ts for why that matters.
 */
export function attachSaveLoadMenu(
    apple2: Apple2,
    canvas: HTMLElement,
    statusEl: HTMLElement,
    els: SaveMenuElements
): void {
    const {
        saveBtn,
        loadBtn,
        saveDialog,
        saveForm,
        saveNameInput,
        saveError,
        saveCancelBtn,
        loadDialog,
        loadList,
        loadEmpty,
        loadCancelBtn,
    } = els;

    // `<dialog>` is a built-in HTML element for modal (and non-modal)
    // popups — `.showModal()` (below) opens it as a true modal, complete
    // with a dimmed backdrop and trapping keyboard focus inside it, all
    // handled natively by the browser rather than needing this app to
    // build that behavior itself. Its `'close'` event fires whenever the
    // dialog closes for *any* reason — clicking a cancel button that
    // calls `.close()`, submitting the form, or (importantly) the browser's
    // own built-in handling of the Escape key, which closes an open
    // `<dialog>` automatically with no code required — which is why this
    // listener catches every dismissal path in one place instead of
    // needing separate refocus logic wherever `.close()` gets called
    // explicitly.
    saveDialog.addEventListener('close', () => canvas.focus());
    loadDialog.addEventListener('close', () => canvas.focus());

    saveBtn.addEventListener('click', () => {
        saveError.hidden = true;
        saveNameInput.value = `Save ${formatSavedAt(Date.now())}`;
        saveDialog.showModal();
        saveNameInput.focus();
        saveNameInput.select();
    });

    saveCancelBtn.addEventListener('click', () => saveDialog.close());

    saveForm.addEventListener('submit', (event) => {
        // A `<form>`'s default behavior on submit is to navigate the
        // page (reloading it, in the simplest case with no `action`
        // attribute) — `preventDefault()` here stops that, since this
        // form's submission is meant to be handled entirely by this JS
        // instead. Using a real `<form>` at all (rather than just a plain
        // button) is what gives this "press Enter in the text field to
        // submit" for free, a common HTML/accessibility convention this
        // app gets to keep without extra code.
        event.preventDefault();
        const name = saveNameInput.value.trim();
        if (!name) {
            return;
        }
        try {
            saveGame(name, captureSnapshot(apple2));
        } catch (err) {
            // `catch (err)` — like several other `catch` blocks across
            // this codebase — receives a value of type `unknown` in
            // strict TypeScript, not `Error`, because JavaScript actually
            // allows `throw`ing *any* value, not just Error objects.
            // `err instanceof Error` checks (and narrows the type)
            // before assuming `.message` exists; the `: String(err)`
            // fallback handles the rarer case where something else
            // entirely was thrown.
            saveError.textContent = err instanceof Error ? err.message : String(err);
            saveError.hidden = false;
            return;
        }
        statusEl.textContent = `Saved "${name}"`;
        saveDialog.close();
    });

    const renderLoadList = () => {
        const saves = listSaves();
        loadList.innerHTML = '';
        loadEmpty.hidden = saves.length > 0;

        for (const meta of saves) {
            loadList.appendChild(renderSaveListItem(meta));
        }
    };

    const renderSaveListItem = (meta: SaveMeta): HTMLLIElement => {
        const item = document.createElement('li');

        const info = document.createElement('div');
        info.className = 'save-list-info';
        const nameEl = document.createElement('span');
        nameEl.className = 'save-list-name';
        nameEl.textContent = meta.name;
        const dateEl = document.createElement('span');
        dateEl.className = 'save-list-date';
        dateEl.textContent = formatSavedAt(meta.savedAt);
        info.appendChild(nameEl);
        info.appendChild(dateEl);

        const actions = document.createElement('div');
        actions.className = 'save-list-actions';

        const loadItemBtn = document.createElement('button');
        loadItemBtn.type = 'button';
        loadItemBtn.textContent = 'Load';
        loadItemBtn.addEventListener('click', () => {
            const state = loadSave(meta.id);
            if (!state) {
                return;
            }
            apple2.stop();
            restoreSnapshot(apple2, state);
            apple2.run();
            statusEl.textContent = `Loaded "${meta.name}"`;
            loadDialog.close();
        });

        const deleteItemBtn = document.createElement('button');
        deleteItemBtn.type = 'button';
        deleteItemBtn.textContent = 'Delete';
        deleteItemBtn.className = 'save-list-delete';
        deleteItemBtn.addEventListener('click', () => {
            deleteSave(meta.id);
            renderLoadList();
        });

        actions.appendChild(loadItemBtn);
        actions.appendChild(deleteItemBtn);

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    };

    loadBtn.addEventListener('click', () => {
        renderLoadList();
        loadDialog.showModal();
    });

    loadCancelBtn.addEventListener('click', () => loadDialog.close());
}
