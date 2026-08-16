/**
 * Wires up simple tab switching within `container`: buttons with
 * `data-tab="name"` toggle visibility of sibling panels with matching
 * `id="tab-panel-name"`. Activates the first tab found.
 */
export function attachTabs(container: HTMLElement): void {
    const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.tab-btn')
    );
    const panels = new Map<string, HTMLElement>();
    for (const btn of buttons) {
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
            btn.setAttribute('aria-selected', String(isActive));
        }
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
