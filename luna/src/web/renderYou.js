const { esc, fmtNum, rar } = require('./youPage');

function form(action, tab, inner, cls = 'inline') {
    return `<form class="${cls}" method="post" action="./action"><input type="hidden" name="action" value="${esc(action)}"><input type="hidden" name="tab" value="${esc(tab)}">${inner}</form>`;
}

function btn(label, cls = 'btn') {
    return `<button class="${cls}" type="submit">${label}</button>`;
}

function msgBox(flash) {
    if (!flash) return '';
    const ok = flash.ok !== false;
    return `<div class="flash ${ok ? 'ok' : 'err'}">${esc(flash.msg).replace(/\n/g, '<br>')}</div>`;
}

function runeTab(d) {
    const buyOptions = d.tierList.map((t) => `<option value="${esc(t.key)}">${esc(t.label)} — ${fmtNum(d.runeBuyPrices[t.key])} 💰</option>`).join('');
    const fuseOptions = d.runes.map((r) => `<option value="${esc(r.id)}">${esc(r.tier)} ⭐${r.stars} ${esc(r.boosts)}</option>`).join('');
    const rows = d.runes.length ? d.runes.map((r) => `
      <div class="card-row">
        <div class="row-main">
          <div class="rune-title">${esc(r.tier)} ${r.stars > 0 ? `⭐${r.stars}/${r.cap}` : ''} ${r.equipped ? '<span class="pill">مجهزة ✅</span>' : ''}</div>
          <div class="muted">${esc(r.boosts) || 'بدون تعزيزات'} · قيمة البيع ${fmtNum(r.value)} 💰</div>
        </div>
        <div class="row-actions">
          ${form(r.equipped ? 'rune_unequip' : 'rune_equip', 'runes', `<input type="hidden" name="runeId" value="${esc(r.id)}">${btn(r.equipped ? 'فك 🔓' : 'تجهيز ⚡', 'btn ghost')}`)}
          ${form('rune_sell', 'runes', `<input type="hidden" name="runeId" value="${esc(r.id)}">${btn('بيع 💸', 'btn danger')}`)}
          ${r.upgradeCost != null ? form('rune_upgrade', 'runes', `<input type="hidden" name="runeId" value="${esc(r.id)}">${btn(`ترقية ⬆️ ${fmtNum(r.upgradeCost)}`, 'btn')}`) : ''}
          ${r.stars < d.rerollCap ? form('rune_reroll', 'runes', `<input type="hidden" name="runeId" value="${esc(r.id)}">${btn(`تدوير 🔁 ${fmtNum(r.rerollCost)}`, 'btn ghost')}`) : ''}
        </div>
      </div>`).join('') : '<p class="muted">ما عندك رونات لسه 😅 ارفع مستواك أو اشتري رونة.</p>';

    return `
      <div class="balance-bar">💰 رصيدك <b>${fmtNum(d.balance)}</b> نقطة · رونات مجهزة <b>${d.equippedCount}/${d.maxEquipped}</b></div>
      <div class="panel">
        <h3>🛒 شراء رونة</h3>
        ${form('rune_buy', 'runes', `<select name="tier">${buyOptions}</select>${btn('اشترِ 🛍️')}`)}
      </div>
      <div class="panel">
        <h3>🧬 دمج 3 رونات <span class="muted">(نفس الطبقة — ${fmtNum(d.fuseCost)} 💰)</span></h3>
        ${form('rune_fuse', 'runes', `<select name="runeIds" multiple size="4">${fuseOptions}</select>${btn('ادمج 🧬')}`, 'stack')}
        <p class="muted">اختر 3 رونات بالضغط مع Ctrl/Cmd.</p>
      </div>
      <div class="panel">
        <h3>🔮 روناتك</h3>
        ${rows}
      </div>`;
}

function shopCard(d, it, section) {
    const price = it.finalPrice < it.price
        ? `~~${fmtNum(it.price)}~~ <b>${fmtNum(it.finalPrice)}</b>`
        : `<b>${fmtNum(it.price)}</b>`;
    const couponBtn = it.id ? form('coupon_apply', 'shop', `<input type="hidden" name="itemId" value="${esc(it.id)}"><input name="code" placeholder="كود خصم" maxlength="24">${btn('تطبيق 🎟️', 'btn ghost')}`) : '';
    return `
      <div class="card-row">
        <div class="row-main">
          <div class="rune-title">${esc(it.name)}</div>
          <div class="muted">${esc(it.kind)} · ${esc(it.rarity)}${it.desc ? ` · ${esc(it.desc)}` : ''}</div>
          <div class="price">💰 ${price}${couponBtn ? ` ${d.pendingCoupon ? `<span class="pill">كود ${esc(d.pendingCoupon)} مطبّق</span>` : ''}` : ''}</div>
          ${couponBtn}
        </div>
        <div class="row-actions">
          ${form('shop_buy', 'shop', `<input type="hidden" name="itemId" value="${esc(it.id)}">${btn('شراء 🛒')}`)}
          ${form('shop_gift', 'shop', `<input type="hidden" name="itemId" value="${esc(it.id)}"><input name="receiverId" placeholder="User ID" inputmode="numeric">${btn('إهداء 🎁', 'btn ghost')}`)}
        </div>
      </div>`;
}

function shopTab(d) {
    const sectionNames = {
        featured: '⭐ Featured اليوم', limited: '🏷️ المحدود اليوم', daily: '🗓️ عروض اليوم',
        weekly: '📅 عروض الأسبوع', utility: '🔧 رتب الصلاحيات', more: '⚡🤝 بوستات وخدمات', mystery: '🎁 صناديق مفاجأة'
    };
    const sections = Object.keys(sectionNames).filter((k) => d.sections[k] && d.sections[k].length).map((k) => `
      <div class="panel">
        <h3>${sectionNames[k]}</h3>
        ${d.sections[k].map((it) => shopCard(d, it, k)).join('')}
      </div>`).join('') || '<p class="muted">ما فيه عروض متاحة الحين 🌙</p>';

    const a = d.auction;
    const auction = a.active ? `
      <div class="panel">
        <h3>🏆 المزاد الأسطوري</h3>
        <div class="muted">أعلى مزايدة ${fmtNum(a.highestBid)} 💰 · الحد الأدنى ${fmtNum(a.minBid)}</div>
        ${form('auction_bid', 'shop', `<input name="amount" placeholder="قيمة المزايدة" inputmode="numeric" min="${a.minBid}">${btn('زايد 💰')}`)}
      </div>` : '';

    return `
      <div class="balance-bar">💰 رصيدك <b>${fmtNum(d.balance)}</b> نقطة · خصمك اليوم <b>${d.discount.percent}%</b>${d.pendingCoupon ? ` · كود <b>${esc(d.pendingCoupon)}</b> مطبّق` : ''}</div>
      ${auction}
      ${sections}`;
}

function inventoryTab(d) {
    const inv = d.inventory;
    const titles = inv.titles.length ? inv.titles.map((t) => `
      <div class="card-row">
        <div class="row-main"><div class="rune-title">${esc(t)} ${inv.activeTitle === t ? '<span class="pill">نشط ✅</span>' : ''}</div></div>
        <div class="row-actions">${inv.activeTitle === t ? '' : form('inv_title', 'inventory', `<input type="hidden" name="title" value="${esc(t)}">${btn('تفعيل 🎭', 'btn ghost')}`)}</div>
      </div>`).join('') : '<p class="muted">ما عندك ألقاب 😅</p>';

    const cards = inv.boostCards.length ? inv.boostCards.map((b, i) => `
      <div class="card-row">
        <div class="row-main"><div class="rune-title">${esc(b.name)}</div></div>
        <div class="row-actions">${form('inv_boost', 'inventory', `<input type="hidden" name="type" value="${esc(b.type)}">${btn('تفعيل ⚡', 'btn ghost')}`)}</div>
      </div>`).join('') : '<p class="muted">ما عندك بوستات غير مفعلة 😅</p>';

    const serviceForms = {
        vip_title: () => form('inv_service', 'inventory', `<input type="hidden" name="key" value="vip_title">${btn('تفعيل 👑')}`),
        reroll_daily: () => form('inv_service', 'inventory', `<input type="hidden" name="key" value="reroll_daily">${btn('استخدام 🎲')}`),
        rename_once: () => form('inv_service', 'inventory', `<input type="hidden" name="key" value="rename_once"><input name="nickname" placeholder="الاسم الجديد" maxlength="32">${btn('تغيير 📝')}`),
        xp_transfer: () => form('inv_service', 'inventory', `<input type="hidden" name="key" value="xp_transfer"><input name="target" placeholder="User ID" inputmode="numeric"><input name="percent" value="20" inputmode="numeric">${btn('نقل 🎯')}`),
        rebalance: () => form('inv_service', 'inventory', `<input type="hidden" name="key" value="rebalance"><input name="confirm" placeholder="اكتب CONFIRM">${btn('تنفيذ 🔄')}`),
        shield: () => form('inv_service', 'inventory', `<input type="hidden" name="key" value="shield">${btn('معلومات 🛡️', 'btn ghost')}`)
    };
    const services = inv.services.length ? inv.services.map((s) => `
      <div class="card-row">
        <div class="row-main"><div class="rune-title">${esc(s.key)} × ${fmtNum(s.count)}</div></div>
        <div class="row-actions">${serviceForms[s.key] ? serviceForms[s.key]() : ''}</div>
      </div>`).join('') : '<p class="muted">ما عندك خدمات 😅</p>';

    const list = (arr) => arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">لا يوجد</p>';
    const purchases = inv.purchases.length ? `<ul>${inv.purchases.map((p) => `<li>${esc(p.name)} — ${fmtNum(p.cost)} 💰 <span class="muted">${new Date(p.at).toLocaleString('ar')}</span></li>`).join('')}</ul>` : '<p class="muted">ما فيه مشتريات لسه ✨</p>';

    return `
      <div class="balance-bar">💰 رصيدك <b>${fmtNum(d.balance)}</b> نقطة</div>
      <div class="panel"><h3>🎭 الألقاب</h3>${titles}</div>
      <div class="panel"><h3>⚡ بوستات جاهزة</h3>${cards}</div>
      <div class="panel"><h3>⏳ بوستات نشطة</h3>${inv.activeBoosts.length ? list(inv.activeBoosts.map((b) => `${b.name} — ${b.remaining}`)) : '<p class="muted">لا يوجد</p>'}</div>
      <div class="panel"><h3>🤝 الخدمات</h3>${services}</div>
      <div class="grid2">
        <div class="panel"><h3>🎨 رتب شكلية</h3>${list(inv.roles.map((r) => r.name))}</div>
        <div class="panel"><h3>🎖️ مقتنيات</h3>${list(inv.collectibles)}</div>
      </div>
      <div class="panel"><h3>🧾 آخر المشتريات</h3>${purchases}</div>`;
}

function renderYou(data, tab, flash) {
    const active = ['runes', 'shop', 'inventory'].includes(tab) ? tab : 'runes';
    const nav = `
      <div class="subnav">
        <a class="${active === 'runes' ? 'active' : ''}" href="?tab=runes">🔮 الرونات</a>
        <a class="${active === 'shop' ? 'active' : ''}" href="?tab=shop">🛍️ المتجر</a>
        <a class="${active === 'inventory' ? 'active' : ''}" href="?tab=inventory">🎒 الممتلكات</a>
      </div>`;
    const content = active === 'runes' ? runeTab(data) : active === 'shop' ? shopTab(data) : inventoryTab(data);
    return `${nav}${msgBox(flash)}<div class="you-content">${content}</div>`;
}

module.exports = { renderYou };
