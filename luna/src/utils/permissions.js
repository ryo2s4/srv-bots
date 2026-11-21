function hasGuildPerm(member, permFlag) {
    try {
        if (!member || !member.permissions || typeof member.permissions.has !== 'function') return false;
        return member.permissions.has(permFlag);
    } catch {
        return false;
    }
}

function hasAnyGuildPerm(member, permFlags) {
    try {
        const list = Array.isArray(permFlags) ? permFlags : [];
        for (const p of list) {
            if (hasGuildPerm(member, p)) return true;
        }
        return false;
    } catch {
        return false;
    }
}

function memberHasAnyRole(member, roleIds) {
    try {
        const ids = Array.isArray(roleIds) ? roleIds.map(String).filter(Boolean) : [];
        if (!member || !member.roles || !member.roles.cache) return false;
        return ids.some((rid) => member.roles.cache.has(String(rid)));
    } catch {
        return false;
    }
}

function isStaff(member, guildCfg, extraRoleIds) {
    try {
        const PermissionsBitField = require('discord.js').PermissionsBitField;
        const staffPerms = [
            PermissionsBitField.Flags.Administrator,
            PermissionsBitField.Flags.ModerateMembers,
            PermissionsBitField.Flags.ManageGuild
        ];
        if (hasAnyGuildPerm(member, staffPerms)) return true;

        const cfgRoles = guildCfg && Array.isArray(guildCfg.staffRoleIds)
            ? guildCfg.staffRoleIds.map(String).filter(Boolean)
            : [];
        const extra = Array.isArray(extraRoleIds) ? extraRoleIds.map(String).filter(Boolean) : [];
        return memberHasAnyRole(member, [...cfgRoles, ...extra]);
    } catch {
        return false;
    }
}

module.exports = { hasGuildPerm, hasAnyGuildPerm, memberHasAnyRole, isStaff }; 
