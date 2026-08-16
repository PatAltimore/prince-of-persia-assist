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
        event.preventDefault();
        const name = saveNameInput.value.trim();
        if (!name) {
            return;
        }
        try {
            saveGame(name, captureSnapshot(apple2));
        } catch (err) {
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
