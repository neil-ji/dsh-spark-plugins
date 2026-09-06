/* js/demo.js — 壳交互：主题切换 · 侧栏高亮 · sparkline · 事件接线 */

(function () {
  var body = document.body;
  var themeToggle = document.getElementById("themeToggle");

  /* ── 主题切换 ── */
  function setTheme(theme) {
    body.setAttribute("data-theme", theme);
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    themeToggle.querySelector(".theme-toggle-label").textContent = theme === "dark" ? "暗" : "亮";
    SparkDemo.renderSwatches(document.getElementById("swatchGrid"), theme);
    drawSparkline();
  }
  themeToggle.addEventListener("click", function () {
    setTheme(body.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  /* ── ListRow 点击反馈 ── */
  document.getElementById("listRowDemo").addEventListener("click", function (e) {
    var row = e.target.closest(".list-row");
    if (!row) return;
    var title = row.querySelector(".list-row-title").textContent;
    SparkDemo.toast(document.getElementById("toastRegion"), {
      acc: "var(--spk-brand)",
      html: "<strong>已打开</strong> " + title.slice(0, 18) + "…",
    });
  });

  /* ── Sparkline ── */
  var svg = document.getElementById("sparkline");
  var NS = "http://www.w3.org/2000/svg";
  var W = 560, H = 140, PAD = 8;
  var data = SparkDemo.SPARKLINE;

  function drawSparkline() {
    svg.innerHTML = "";
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data);
    var span = max - min || 1;
    function pt(i) {
      return [
        PAD + (i / (data.length - 1)) * (W - PAD * 2),
        H - PAD - ((data[i] - min) / span) * (H - PAD * 2),
      ];
    }
    var d = data.map(function (_, i) {
      var p = pt(i);
      return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join(" ");

    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML =
      '<linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="var(--spk-brand)" stop-opacity="0.28"/>'
      + '<stop offset="100%" stop-color="var(--spk-brand)" stop-opacity="0"/>'
      + "</linearGradient>";
    svg.appendChild(defs);

    var area = document.createElementNS(NS, "path");
    area.setAttribute("d", d + " L" + (W - PAD) + " " + (H - PAD) + " L" + PAD + " " + (H - PAD) + " Z");
    area.setAttribute("fill", "url(#sparkFill)");
    svg.appendChild(area);

    var line = document.createElementNS(NS, "path");
    line.setAttribute("d", d);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "var(--spk-brand)");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);

    var last = pt(data.length - 1);
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", last[0]); dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", "var(--spk-brand)");
    dot.setAttribute("stroke", "var(--spk-bg)");
    dot.setAttribute("stroke-width", "2");
    svg.appendChild(dot);

    // hover 十字线
    var cross = document.createElementNS(NS, "line");
    cross.setAttribute("y1", PAD); cross.setAttribute("y2", H - PAD);
    cross.setAttribute("stroke", "var(--spk-border-2)");
    cross.setAttribute("stroke-dasharray", "3 3");
    cross.style.opacity = "0";
    svg.appendChild(cross);

    svg.addEventListener("mousemove", function (e) {
      var rect = svg.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * W;
      var i = Math.round(((x - PAD) / (W - PAD * 2)) * (data.length - 1));
      i = Math.max(0, Math.min(data.length - 1, i));
      var p = pt(i);
      cross.setAttribute("x1", p[0]); cross.setAttribute("x2", p[0]);
      cross.style.opacity = "1";
      document.getElementById("chartValue").textContent = data[i].toLocaleString();
    });
    svg.addEventListener("mouseleave", function () {
      cross.style.opacity = "0";
      document.getElementById("chartValue").textContent = data[data.length - 1].toLocaleString();
    });
  }

  /* ── 侧栏 scrollspy ── */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".sidenav a"));
  var sections = navLinks.map(function (a) {
    return document.querySelector(a.getAttribute("href"));
  });
  function spy() {
    var y = window.scrollY + 120;
    var idx = 0;
    sections.forEach(function (sec, i) {
      if (sec && sec.offsetTop <= y) idx = i;
    });
    navLinks.forEach(function (a, i) { a.classList.toggle("is-active", i === idx); });
  }
  window.addEventListener("scroll", spy, { passive: true });

  /* ── 事件接线 ── */
  var modal = SparkDemo.initModal(document.getElementById("modalRoot"));
  var toastRegion = document.getElementById("toastRegion");
  document.getElementById("openModal").addEventListener("click", modal.open);
  document.getElementById("heroModal").addEventListener("click", modal.open);
  document.getElementById("heroCta").addEventListener("click", function () {
    SparkDemo.toast(toastRegion, SparkDemo.TOASTS.success);
  });
  document.getElementById("modalConfirm").addEventListener("click", function () {
    modal.close();
    SparkDemo.toast(toastRegion, SparkDemo.TOASTS.success);
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-toast]"), function (btn) {
    btn.addEventListener("click", function () {
      SparkDemo.toast(toastRegion, SparkDemo.TOASTS[btn.getAttribute("data-toast")]);
    });
  });

  /* ── 初始化 ── */
  SparkDemo.renderSwatches(document.getElementById("swatchGrid"), "dark");
  SparkDemo.renderListRows(document.getElementById("listRowDemo"));
  SparkDemo.renderDisclosures(document.getElementById("disclosureDemo"));
  SparkDemo.initSegmented(document.getElementById("segDemo"));
  drawSparkline();
  spy();
})();
