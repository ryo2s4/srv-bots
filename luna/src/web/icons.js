// Minimal inline SVG icon set. No external assets, no emoji.
const paths = {
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    gem: '<path d="M6 3h12l4 6-10 12L2 9l4-6Z"/><path d="M2 9h20M9 3 7 9l5 12 5-12-2-6"/>',
    bag: '<path d="M4 8h16l-1 13H5L4 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    box: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="M3 7v10l9 5 9-5V7M12 12v10"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h4"/>',
    medal: '<circle cx="12" cy="14" r="6"/><path d="m8 3 2 5M16 3l-2 5M12 8v12"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/>',
    arrow: '<path d="M19 12H5M12 5l-7 7 7 7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    warn: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13"/><path d="M12 8S9 3 6.5 4.5 9 8 12 8Zm0 0s3-5 5.5-3.5S15 8 12 8Z"/>',
    ticket: '<path d="M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4V7Z"/><path d="M12 5v2M12 11v2M12 17v2"/>',
    merge: '<path d="M7 3v6a4 4 0 0 0 4 4h6M17 9l4 4-4 4"/><path d="M7 21v-4M7 8a4 4 0 0 1 4-4h6M17 3l4 4-4 4"/>',
    up: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    crown: '<path d="m3 7 4 4 5-7 5 7 4-4-2 12H5L3 7Z"/><path d="M5 19h14"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
    pencil: '<path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z"/><path d="m14 6 3 3"/>',
    swap: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
    balance: '<path d="M12 3v18M5 7h14M5 7 2 14h6L5 7Zm14 0-3 7h6l-3-7Z"/><path d="M8 21h8"/>',
    receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    star: '<path d="m12 3 2.7 5.6 6.3.9-4.5 4.3 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.5l6.3-.9L12 3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};

function icon(name, size = 18) {
    const d = paths[name] || paths.info;
    size = Math.round((Number(size) || 18) * 1.2);
    return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

module.exports = { icon, paths };
