/**
 * Wires up simple tab switching within `container`: buttons with
 * `data-tab="name"` toggle visibility of sibling panels with matching
 * `id="tab-panel-name"`. Activates the first tab found.
 */
export function attachTabs(container: HTMLElement): void {
    // `querySelectorAll` returns a `NodeList`, not a real JS `Array` — it
    // has `.length` and can be indexed, but lacks array methods like
    // `.map()`/`.find()`. `Array.from(...)` copies it into a genuine
    // array so the rest of this function can use ordinary array
    // operations (the `for...of` loops below would actually work fine on
    // the NodeList directly, since it's iterable, but treating it as a
    // proper array from the start avoids that gotcha for any future code
    // added here).
    const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.tab-btn')
    );
    const panels = new Map<string, HTMLElement>();
    for (const btn of buttons) {
        // `.dataset` is the DOM's typed view onto an element's
        // `data-*` HTML attributes — `data-tab="map"` in the markup
        // becomes `btn.dataset.tab === 'map'` here, camelCased from the
        // hyphenated attribute name (`data-foo-bar` would become
        // `.dataset.fooBar`). It's the standard way to attach small bits
        // of plain-string data to an element without inventing custom
        // attributes of your own.
        const name = btn.dataset.tab;
        if (!name) {
            continue;
        }
        const panel = container.querySelector<HTMLElement>(
            `#tab-panel-${name}`
        );
        if (panel) {
            panels.set(name, panel);
        }
    }

    const activate = (name: string) => {
        for (const btn of buttons) {
            const isActive = btn.dataset.tab === name;
            btn.classList.toggle('active', isActive);
            // `aria-selected` is an accessibility attribute screen readers
            // use to announce which tab is currently active — kept in
            // sync alongside the `active` CSS class (which handles the
            // *visual* highlighting) since the two serve different
            // audiences and neither one implies the other automatically.
            btn.setAttribute('aria-selected', String(isActive));
        }
        // `panel.hidden = ...` sets the element's `hidden` property
        // directly (as opposed to `.setAttribute('hidden', ...)`) — for
        // this specific boolean HTML attribute, the DOM exposes it as a
        // real JS boolean property that reflects the attribute
        // automatically, which is simpler to toggle than manipulating the
        // attribute as a string. (This works cleanly here because nothing
        // in style.css overrides these particular elements' `display`
        // — contrast with HintsSidePane.ts's action-log empty-state
        // message, where a conflicting CSS rule meant `.hidden` alone
        // wasn't enough and an explicit `style.display` was needed
        // instead.)
        for (const [key, panel] of panels) {
            panel.hidden = key !== name;
        }
    };

    for (const btn of buttons) {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab) {
                activate(btn.dataset.tab);
            }
        });
    }

    const first = buttons[0]?.dataset.tab;
    if (first) {
        activate(first);
    }
}
