const { PermissionsBitField } = require('discord.js');

async function ensureAntiRaidVerifyRole(guild, roleId) {
    if (!guild) return null;
    const rid = roleId ? String(roleId) : '';
    let role = rid ? guild.roles.cache.get(rid) : null;
    if (!role && rid) {
        try {
            role = await guild.roles.fetch(rid);
        } catch {
            role = null;
        }
    }
    if (role) return role;

    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!me || !me.permissions || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return null;

    try {
        role = await guild.roles.create({
            name: 'Unverified',
            mentionable: false,
            hoist: false,
            reason: 'Anti-raid verification role'
        });
        return role;
    } catch {
        return null;
    }
}

async function applyUnverifiedToRecentMembers(guild, role, retroMs) {
    if (!guild || !role || !retroMs) return;
    const retroWindowMs = Math.max(0, Math.floor(Number(retroMs) || 0));
    if (!retroWindowMs) return;

    const now = Date.now();
    const minJoined = now - retroWindowMs;

    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!me || !me.permissions || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
    if (!me.roles || !me.roles.highest || me.roles.highest.comparePositionTo(role) <= 0) return;

    let membersMap = guild.members && guild.members.cache ? guild.members.cache : null;
    if (!membersMap) return;

    // Safety: avoid fetching the entire guild on huge servers.
    try {
        if (typeof guild.memberCount === 'number' && guild.memberCount > 2000) {
            // Best-effort using cache only.
        } else {
            await guild.members.fetch().catch(() => null);
            membersMap = guild.members.cache;
        }
    } catch {
        // ignore
    }

    const toApply = [];
    for (const [, m] of membersMap) {
        try {
            if (!m || !m.user || m.user.bot) continue;
            const jt = Number(m.joinedTimestamp) || 0;
            if (!jt || jt < minJoined) continue;
            if (m.roles && m.roles.cache && m.roles.cache.has(role.id)) continue;
            toApply.push(m);
        } catch {
        }
    }

    for (const m of toApply.slice(0, 200)) {
        try {
            await m.roles.add(role.id, 'Anti-raid retro verification');
        } catch {
        }
    }
}

async function setAntiRaidRoleOverwrites(guild, roleId, enabled) {
    if (!guild || !roleId) return;
    const rid = String(roleId);
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!me || !me.permissions || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;

    const targets = guild.channels && guild.channels.cache ? [...guild.channels.cache.values()] : [];
    for (const ch of targets) {
        try {
            if (!ch || !ch.isTextBased || !ch.isTextBased()) continue;
            if (!ch.permissionOverwrites) continue;
            if (enabled) {
                await ch.permissionOverwrites.edit(rid, {
                    SendMessages: false,
                    AddReactions: false,
                    CreatePublicThreads: false,
                    CreatePrivateThreads: false,
                    SendMessagesInThreads: false
                });
            } else {
                await ch.permissionOverwrites.delete(rid).catch(() => null);
            }
        } catch {
        }
    }
}

module.exports = {
    ensureAntiRaidVerifyRole,
    applyUnverifiedToRecentMembers,
    setAntiRaidRoleOverwrites
};
