const { clean, fmtNum } = require('./youPage');
const { icon } = require('./icons');

function form(token, action, tab, inner, cls = 'inline') {
    const ajax = action.startsWith('rune_') ? ' data-rune-ajax' : '';
    return `<form class="${cls}"${ajax} method="post" action="/p/${encodeURIComponent(token)}/action"><input type="hidden" name="action" value="${action}"><input type="hidden" name="tab" value="${tab}">${inner}</form>`;
}

function btn(label, ico, cls = 'btn') {
    return `<button class="${cls}" type="submit">${ico ? icon(ico, 14) : ''}<span>${label}</span></button>`;
}

function head(ico, title, note = '') {
    return `<div class="panel-head"><h2>${icon(ico, 16)} ${title}</h2>${note ? `<span>${clean(note)}</span>` : ''}</div>`;
}

function runeTab(d, token) {
    const buyOptions = d.tierList.map((t) => `<option value="${t.key}">${clean(t.label)} — ${fmtNum(d.runeBuyPrices[t.key])} Luna</option>`).join('');
    const fuseOptions = d.runes.map((r) => `<option value="${clean(r.id)}">${clean(r.tier)} ${r.stars > 0 ? `${icon('star', 12)} ${r.stars}` : ''} ${clean(r.boosts)}</option>`).join('');

    const rows = d.runes.length ? d.runes.map((r) => `
      <div class="row rune-row" data-rune-id="${clean(r.id)}">
        <div class="row-main">
          <div class="row-title">${clean(r.tier)} ${r.stars > 0 ? `<span class="tag gold">${icon('star', 11)} ${r.stars}/${r.cap}</span>` : ''} <span class="status-tag ${r.equipped ? 'on' : ''}">${r.equipped ? 'EQUIPPED' : 'UN-EQUIPPED'}</span></div>
          <div class="muted rune-stats">${clean(r.boosts) || 'No bonuses'} · Sell value ${fmtNum(r.value)}</div>
        </div>
        <div class="row-actions">
          ${form(token, r.equipped ? 'rune_unequip' : 'rune_equip', 'runes', `<input type="hidden" name="runeId" value="${clean(r.id)}">${btn(r.equipped ? 'Unequip' : 'Equip', r.equipped ? 'lock' : 'bolt', 'btn ghost')}`)}
          ${form(token, 'rune_sell', 'runes', `<input type="hidden" name="runeId" value="${clean(r.id)}">${btn('Sell', 'cash', 'btn danger')}`)}
          ${r.upgradeCost != null ? form(token, 'rune_upgrade', 'runes', `<input type="hidden" name="runeId" value="${clean(r.id)}">${btn(`Upgrade ${fmtNum(r.upgradeCost)}`, 'up', 'btn ghost')}`) : ''}
          ${r.stars < d.rerollCap ? form(token, 'rune_reroll', 'runes', `<input type="hidden" name="runeId" value="${clean(r.id)}">${btn(`Reroll ${fmtNum(r.rerollCost)}`, 'refresh', 'btn ghost')}`) : ''}
        </div>
      </div>`).join('') : '<p class="muted">No runes yet. Buy one below or level up.</p>';

    return `
      <div id="runes-content">
      ${head('gem', 'الرونات', `Equipped ${d.equippedCount}/${d.maxEquipped}`)}
      <div class="panel">
        <h3>${icon('plus', 15)} Buy rune</h3>
        ${form(token, 'rune_buy', 'runes', `<select name="tier">${buyOptions}</select>${btn('Buy', 'bag', 'btn primary')}`)}
      </div>
      <div class="panel">
        <h3>${icon('merge', 15)} Fuse 3 runes <small>same tier — ${fmtNum(d.fuseCost)} Luna</small></h3>
        ${form(token, 'rune_fuse', 'runes', `<select name="runeIds" multiple size="4">${fuseOptions}</select>${btn('Fuse', 'merge', 'btn primary')}`, 'stack')}
        <p class="muted">Select exactly 3 runes (Ctrl / Cmd + click).</p>
      </div>
      <div class="panel"><h3>${icon('gem', 15)} Your runes <small>${d.runes.length}</small></h3>${rows}</div>
      </div>`;
}

function shopCard(d, it, token) {
    const price = it.finalPrice < it.price
        ? `<s>${fmtNum(it.price)}</s> <b>${fmtNum(it.finalPrice)}</b>`
        : `<b>${fmtNum(it.price)}</b>`;
    return `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${clean(it.name)}</div>
          <div class="muted">${clean(it.kind)} · ${clean(it.rarity)}${it.desc ? ` · ${clean(it.desc)}` : ''}</div>
          <div class="price">${price} Luna</div>
          <div class="inline" style="margin-top:8px">
            ${form(token, 'coupon_apply', 'shop', `<input name="code" placeholder="Coupon code" maxlength="24">${btn('Apply', 'ticket', 'btn ghost')}`)}
            ${d.pendingCoupon ? `<span class="tag">${clean(d.pendingCoupon)} applied</span>` : ''}
          </div>
        </div>
        <div class="row-actions">
          ${form(token, 'shop_buy', 'shop', `<input type="hidden" name="itemId" value="${clean(it.id)}">${btn('Buy', 'bag', 'btn primary')}`)}
          ${form(token, 'shop_gift', 'shop', `<input type="hidden" name="itemId" value="${clean(it.id)}"><input name="receiverId" placeholder="User ID" inputmode="numeric">${btn('Gift', 'gift', 'btn ghost')}`)}
        </div>
      </div>`;
}

function shopTab(d, token) {
    const sections = [
        ['featured', 'bag', 'Featured today'],
        ['limited', 'star', 'Limited today'],
        ['daily', 'refresh', 'Daily rotation'],
        ['weekly', 'refresh', 'Weekly rotation'],
        ['utility', 'shield', 'Permission roles'],
        ['more', 'bolt', 'Boosts and services'],
        ['mystery', 'gift', 'Mystery boxes']
    ];
    const panels = sections.filter(([key]) => d.sections[key]?.length).map(([key, ico, title]) => `
      <div class="panel"><h3>${icon(ico, 15)} ${title}</h3>${d.sections[key].map((it) => shopCard(d, it, token)).join('')}</div>`).join('') || '<div class="panel"><p class="muted">No items available right now.</p></div>';

    const a = d.auction;
    const auction = a.active ? `
      <div class="panel">
        <h3>${icon('trophy', 15)} Legendary auction</h3>
        <div class="muted">Highest bid ${fmtNum(a.highestBid)} · Minimum ${fmtNum(a.minBid)}</div>
        <div style="margin-top:10px">${form(token, 'auction_bid', 'shop', `<input name="amount" placeholder="Bid amount" inputmode="numeric" min="${a.minBid}">${btn('Bid', 'coin', 'btn primary')}`)}</div>
      </div>` : '';

    return `${head('bag', 'المتجر', `Daily discount ${d.discount.percent}%${d.pendingCoupon ? ` · ${clean(d.pendingCoupon)}` : ''}`)}${auction}${panels}`;
}

function inventoryTab(d, token) {
    const inv = d.inventory;
    const titles = inv.titles.length ? inv.titles.map((t) => `
      <div class="row">
        <div class="row-main"><div class="row-title">${clean(t)} ${inv.activeTitle === t ? '<span class="tag">ACTIVE</span>' : ''}</div></div>
        <div class="row-actions">${inv.activeTitle === t ? '' : form(token, 'inv_title', 'inventory', `<input type="hidden" name="title" value="${clean(t)}">${btn('Activate', 'check', 'btn ghost')}`)}</div>
      </div>`).join('') : '<p class="muted">No titles owned.</p>';

    const cards = inv.boostCards.length ? inv.boostCards.map((b) => `
      <div class="row">
        <div class="row-main"><div class="row-title">${clean(b.name)}</div></div>
        <div class="row-actions">${form(token, 'inv_boost', 'inventory', `<input type="hidden" name="type" value="${clean(b.type)}">${btn('Activate', 'bolt', 'btn ghost')}`)}</div>
      </div>`).join('') : '<p class="muted">No inactive boosts.</p>';

    const svcForms = {
        vip_title: () => form(token, 'inv_service', 'inventory', `<input type="hidden" name="key" value="vip_title">${btn('Activate', 'crown', 'btn ghost')}`),
        reroll_daily: () => form(token, 'inv_service', 'inventory', `<input type="hidden" name="key" value="reroll_daily">${btn('Use', 'refresh', 'btn ghost')}`),
        rename_once: () => form(token, 'inv_service', 'inventory', `<input type="hidden" name="key" value="rename_once"><input name="nickname" placeholder="New name" maxlength="32">${btn('Rename', 'pencil', 'btn ghost')}`),
        xp_transfer: () => form(token, 'inv_service', 'inventory', `<input type="hidden" name="key" value="xp_transfer"><input name="target" placeholder="User ID" inputmode="numeric"><input name="percent" value="20" inputmode="numeric">${btn('Transfer', 'swap', 'btn ghost')}`),
        rebalance: () => form(token, 'inv_service', 'inventory', `<input type="hidden" name="key" value="rebalance"><input name="confirm" placeholder="Type CONFIRM">${btn('Rebalance', 'balance', 'btn ghost')}`),
        shield: () => form(token, 'inv_service', 'inventory', `<input type="hidden" name="key" value="shield">${btn('Info', 'info', 'btn ghost')}`)
    };
    const services = inv.services.length ? inv.services.map((s) => `
      <div class="row">
        <div class="row-main"><div class="row-title">${clean(s.key)} × ${fmtNum(s.count)}</div></div>
        <div class="row-actions">${svcForms[s.key] ? svcForms[s.key]() : ''}</div>
      </div>`).join('') : '<p class="muted">No services owned.</p>';

    const list = (arr) => arr.length ? `<ul class="list">${arr.map((x) => `<li>${clean(x)}</li>`).join('')}</ul>` : '<p class="muted">Empty</p>';
    const purchases = inv.purchases.length ? `<ul class="list">${inv.purchases.map((p) => `<li><b>${clean(p.name)}</b> — ${fmtNum(p.cost)} <span class="muted">${new Date(p.at).toLocaleString('ar')}</span></li>`).join('')}</ul>` : '<p class="muted">No purchases yet.</p>';

    return `
      ${head('box', 'ممتلكاتي')}
      <div class="grid2">
        <div class="panel"><h3>${icon('user', 15)} Titles</h3>${titles}</div>
        <div class="panel"><h3>${icon('bolt', 15)} Boost cards</h3>${cards}</div>
      </div>
      <div class="panel"><h3>${icon('refresh', 15)} Active boosts</h3>${inv.activeBoosts.length ? list(inv.activeBoosts.map((b) => `${b.name} — ${b.remaining}`)) : '<p class="muted">Empty</p>'}</div>
      <div class="panel"><h3>${icon('shield', 15)} Services</h3>${services}</div>
      <div class="grid2">
        <div class="panel"><h3>${icon('medal', 15)} Cosmetic roles</h3>${list(inv.roles.map((r) => r.name))}</div>
        <div class="panel"><h3>${icon('trophy', 15)} Collectibles</h3>${list(inv.collectibles)}</div>
      </div>
      <div class="panel"><h3>${icon('receipt', 15)} Recent purchases</h3>${purchases}</div>`;
}

function renderYou(data, tab, token) {
    if (tab === 'shop') return shopTab(data, token);
    if (tab === 'inventory') return inventoryTab(data, token);
    return runeTab(data, token);
}

module.exports = { renderYou };
