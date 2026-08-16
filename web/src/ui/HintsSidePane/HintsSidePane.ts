import { SOURCE_FILE_MANIFEST } from './sourceFileManifest';
import { codeMuseumUrlForFile, CODE_MUSEUM_ROOT_URL } from '../../config/codeMuseumLinks';

/**
 * Renders the source-file hints list into the given container (the "Code"
 * tab panel — see Tabs.ts). Each entry links out to its Code Museum
 * article in a new tab (see codeMuseumLinks.ts for the deep-link format).
 */
export function renderHintsSidePane(container: HTMLElement): void {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Source & hints';
    container.appendChild(heading);

    const rootLink = document.createElement('a');
    rootLink.href = CODE_MUSEUM_ROOT_URL;
    rootLink.target = '_blank';
    rootLink.rel = 'noopener';
    rootLink.className = 'hints-root-link';
    rootLink.textContent = 'Browse all articles on Code Museum ↗';
    container.appendChild(rootLink);

    const list = document.createElement('ul');
    list.className = 'hints-list';

    for (const entry of SOURCE_FILE_MANIFEST) {
        const item = document.createElement('li');

        const link = document.createElement('a');
        link.href = codeMuseumUrlForFile(entry.filename);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = entry.filename;

        const desc = document.createElement('span');
        desc.className = 'hints-desc';
        desc.textContent = entry.description;

        item.appendChild(link);
        item.appendChild(desc);
        list.appendChild(item);
    }

    container.appendChild(list);
}
