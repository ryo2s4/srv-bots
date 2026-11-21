const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function xoWinner(board) {
    try {
        const b = Array.isArray(board) ? board : [];
        const lines = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        for (const [a, c, d] of lines) {
            const v = b[a];
            if (v && v === b[c] && v === b[d]) return v;
        }
        return null;
    } catch {
        return null;
    }
}

function xoIsFull(board) {
    const b = Array.isArray(board) ? board : [];
    for (let i = 0; i < 9; i++) {
        if (!b[i]) return false;
    }
    return true;
}

function xoRenderComponents(board) {
    const b = Array.isArray(board) ? board : Array(9).fill(null);
    const rows = [];
    for (let r = 0; r < 3; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < 3; c++) {
            const idx = r * 3 + c;
            const v = b[idx];
            const label = v === 'X' ? 'X' : v === 'O' ? 'O' : '·';
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`event:xo:${idx}`)
                    .setLabel(label)
                    .setStyle(v ? ButtonStyle.Secondary : ButtonStyle.Primary)
                    .setDisabled(!!v)
            );
        }
        rows.push(row);
    }
    return rows;
}

module.exports = {
    xoWinner,
    xoIsFull,
    xoRenderComponents
};
