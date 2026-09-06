/* js/components.js — 组件渲染器：输入纯数据，输出 DOM（无业务逻辑） */

window.SparkDemo = window.SparkDemo || {};

/* 渲染色板（跟随主题取色） */
SparkDemo.renderSwatches = function (root, theme) {
  root.innerHTML = SparkDemo.SWATCHES.map(function (s) {
    return '<div class="swatch">'
      + '<div class="swatch-chip" style="background:' + s[theme] + '"></div>'
      + '<div class="swatch-name">' + s.name + '</div>'
      + '</div>';
  }).join("");
};

/* 渲染 ListRow（整行 button + 独立 trailing div，避免 button-in-button） */
SparkDemo.renderListRows = function (root) {
  root.innerHTML = "";
  SparkDemo.LIST_ROWS.forEach(function (r) {
    var row = document.createElement("div");
    row.style.display = "contents";
    row.innerHTML =
      '<button class="list-row' + (r.archived ? " is-archived" : "") + '" style="--row-acc:' + r.acc + '">'
      + '<span class="list-row-main">'
      + '<span class="list-row-title">' + r.title + "</span>"
      + '<span class="list-row-meta">' + r.meta + "</span>"
      + "</span></button>"
      + '<div class="list-row-trailing">'
      + (r.badge && r.badge.text
        ? '<span class="pill ' + r.badge.cls + '"'
          + (r.badge.cls ? "" : ' style="--pill-acc:var(--spk-label-3)"')
          + ">" + r.badge.text + "</span>"
        : "")
      + '<span class="list-row-time">' + r.time + "</span></div>";
    root.appendChild(row);
  });
};

/* 渲染 Disclosure（可折叠组） */
SparkDemo.renderDisclosures = function (root) {
  SparkDemo.DISCLOSURES.forEach(function (d) {
    var el = document.createElement("div");
    el.className = "disclosure";
    el.setAttribute("aria-expanded", "false");
    el.innerHTML =
      '<button class="disclosure-head" aria-expanded="false">'
      + '<svg class="disclosure-chev" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>'
      + '<span class="disclosure-titles">'
      + '<p class="disclosure-name">' + d.name + "</p>"
      + '<p class="disclosure-desc">' + d.desc + "</p>"
      + "</span>"
      + "</button>"
      + '<div class="disclosure-panel"><div class="disclosure-panel-inner">'
      + '<div class="disclosure-body">' + d.body + "</div>"
      + "</div></div>";
    var head = el.querySelector(".disclosure-head");
    head.addEventListener("click", function () {
      var open = el.getAttribute("aria-expanded") === "true";
      el.setAttribute("aria-expanded", String(!open));
      head.setAttribute("aria-expanded", String(!open));
    });
    head.style.setProperty("--row-acc", d.acc);
    root.appendChild(el);
  });
};

/* SegmentedControl：滑块位移 + aria 同步 */
SparkDemo.initSegmented = function (root) {
  var thumb = root.querySelector(".segmented-thumb");
  var buttons = Array.prototype.slice.call(root.querySelectorAll("[role='tab']"));

  function move(btn) {
    thumb.style.left = btn.offsetLeft + "px";
    thumb.style.width = btn.offsetWidth + "px";
  }
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      buttons.forEach(function (b) { b.setAttribute("aria-selected", String(b === btn)); });
      move(btn);
    });
  });
  requestAnimationFrame(function () {
    move(root.querySelector("[aria-selected='true']"));
    // 字体加载后宽度可能变化，再校准一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        move(root.querySelector("[aria-selected='true']"));
      });
    }
  });
  window.addEventListener("resize", function () {
    move(root.querySelector("[aria-selected='true']"));
  });
};

/* Modal：打开 / 关闭（退出快于进入）+ 焦点管理 */
SparkDemo.initModal = function (modalRoot) {
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modalRoot.hidden = false;
    modalRoot.classList.remove("is-closing");
    var first = modalRoot.querySelector(".modal-foot .spk-btn--ghost");
    if (first) first.focus();
    document.addEventListener("keydown", onKey);
  }
  function close() {
    modalRoot.classList.add("is-closing");
    document.removeEventListener("keydown", onKey);
    var done = function () {
      modalRoot.hidden = true;
      modalRoot.classList.remove("is-closing");
      if (lastFocus) lastFocus.focus();
    };
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { done(); return; }
    modalRoot.querySelector(".modal").addEventListener("animationend", done, { once: true });
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      // 简易焦点陷阱
      var focusables = modalRoot.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])");
      var list = Array.prototype.filter.call(focusables, function (el) { return el.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  }
  modalRoot.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) close();
  });
  return { open: open, close: close };
};

/* Toast */
SparkDemo.toast = function (region, def) {
  var el = document.createElement("div");
  el.className = "toast";
  el.style.setProperty("--toast-acc", def.acc);
  el.innerHTML = def.html;
  region.appendChild(el);
  var ttl = 3600;
  setTimeout(function () {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", function () { el.remove(); }, { once: true });
  }, ttl);
};
