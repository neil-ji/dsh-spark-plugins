/* js/motion.js — 灵动引擎：滚动编排 · 指针辉光 · 涟漪 · 生长 · 数字滚动 · 主题柔化 */

(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ── 1. 滚动入场编排（IntersectionObserver + 区块内交错） ── */
  var sections = document.querySelectorAll(".demo-section, .hero");
  sections.forEach(function (sec) {
    // 同区块内的卡片/行做 60ms 步进交错
    var targets = sec.querySelectorAll(".card, .settings-card, .terminal, .swatch-grid");
    targets.forEach(function (t, i) {
      t.classList.add("reveal");
      t.style.setProperty("--reveal-delay", Math.min(i * 60, 240) + "ms");
    });
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("is-in");
      if (e.target.classList.contains("chart-card")) drawInSparkline(e.target);
      if (e.target.classList.contains("settings-card")) pulseStats(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  /* 色板交错弹入 */
  var grid = document.querySelector(".swatch-grid");
  if (grid) {
    grid.querySelectorAll(".swatch").forEach(function (s, i) {
      s.style.setProperty("--pop-delay", Math.min(i * 35, 420) + "ms");
    });
    new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) { grid.classList.add("is-in"); obs.disconnect(); }
    }, { threshold: 0.2 }).observe(grid);
  }

  /* ── 2. 指针跟随辉光 + 轻微视差 ── */
  document.querySelectorAll(".card, .settings-card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    });
  });

  /* ── 3. 按钮涟漪 ── */
  document.addEventListener("pointerdown", function (e) {
    var btn = e.target.closest(".spk-btn:not(:disabled)");
    if (!btn || reduced.matches) return;
    var r = btn.getBoundingClientRect();
    var d = Math.max(r.width, r.height);
    var rip = document.createElement("span");
    rip.className = "ripple";
    rip.style.width = rip.style.height = d + "px";
    rip.style.left = (e.clientX - r.left - d / 2) + "px";
    rip.style.top = (e.clientY - r.top - d / 2) + "px";
    btn.appendChild(rip);
    rip.addEventListener("animationend", function () { rip.remove(); }, { once: true });
  });

  /* ── 4. Sparkline 生长：描线 → 填充 → 终点弹出 ── */
  window.drawInSparkline = function () {
    var svg = document.getElementById("sparkline");
    if (!svg) return;
    var line = svg.querySelector("path[stroke]");
    var area = svg.querySelector("path[fill]:not([stroke])");
    var dot = svg.querySelector("circle");
    if (line) {
      line.classList.add("spark-line");
      var len = line.getTotalLength();
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = reduced.matches ? "0" : len;
    }
    if (area) area.classList.add("spark-area");
    if (dot) dot.classList.add("spark-dot");
    // 下一帧再触发，保证 transition 生效（dashoffset 走内联值，避免被 CSS 类压不住）
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        svg.classList.add("is-drawn");
        if (line && !reduced.matches) line.style.strokeDashoffset = "0";
      });
    });
  };

  /* ── 5. 数字滚动（chartValue 与 .stat strong） ── */
  function countUp(el, to, dur) {
    if (reduced.matches) { el.textContent = to.toLocaleString(); return; }
    var from = Math.floor(to * 0.86);
    var t0 = performance.now();
    function tick(t) {
      var p = Math.min((t - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(from + (to - from) * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  window.pulseStats = function (root) {
    var chartVal = document.getElementById("chartValue");
    if (chartVal) countUp(chartVal, 1284, 1100);
    root.querySelectorAll(".stat strong").forEach(function (el) {
      var num = parseFloat(el.textContent.replace(/,/g, ""));
      if (!isNaN(num) && !/%/.test(el.textContent)) countUp(el, num, 900);
    });
  };

  /* ── 6. 主题切换柔化：加类 → 过渡完摘除 ── */
  var themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      document.body.classList.add("theme-anim");
      setTimeout(function () { document.body.classList.remove("theme-anim"); }, 400);
    });
  }
})();
