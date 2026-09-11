/* ─────────── 模块定义 ─────────── */
const ICONS = {
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4z"/></svg>',
  hippomemo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M8.9 8.4 11 15.1M15.1 8.4 13 15.1M7 9.4V17M17 9.4V17" stroke-linecap="round"/></svg>',
  finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.6v8.8M9 8.5c0-.6 1.3-1 3-1s3 .4 3 1-1.2.9-3 1.2-3 .7-3 1.3 1.2 1 3 1 3-.4 3-1M12 7.6v1.4M12 15.2v1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M6 8.4v7.2M18 11.4c0 2-1 3.2-2.4 3.8M6 12c1.8 0 3.6.8 5.4 2.4M6 6h0" stroke-linecap="round"/></svg>',
  npm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 21 8.2v7.6L12 21 3 15.8V8.2 12 3zM3 8.2l9 5.2 9-5.2M12 13.4V21" stroke-linejoin="round" stroke-linecap="round"/></svg>',
};

/* 模块 accent 两档：accent = 实色（指示条 / 图表 / 圆点），accentFg = 文字态（图标 / 胶囊文字）。
   与 packages/dsh-ui-kit/src/styles/spark-tokens.css v4 的 --spk-acc-* / --spk-acc-*-fg 同规。

   显示名规范（2026-09 五插件统一，与 packages/dsh-spark-dock/src/client/modules.tsx 逐字一致）：
   认知层 = 「中文名 + 英文产品名」，连接器 = 产品名的规范拼写本身。 */
const MODULES = [
  { id:'spark', order:10, icon:'spark', accent:'var(--acc-spark)', accentFg:'var(--acc-spark-fg)', label:'火花',
    name:'火花 Spark', sub:'手动捕获 · 结晶 · 涌现提议 · 脚本目录 · Graph' },
  { id:'hippomemo', order:20, icon:'hippomemo', accent:'var(--acc-hippomemo)', accentFg:'var(--acc-hippomemo-fg)', label:'记忆',
    name:'记忆 HippoMemo', sub:'四脑区总览 · 搜索/筛选 · 我的偏好 · 进化引擎' },
  { id:'finance', order:30, icon:'finance', accent:'var(--acc-finance)', accentFg:'var(--acc-finance-fg)', label:'财务',
    name:'财务 Finance', sub:'余额 · Token 用量与成本总览' },
  { id:'github', order:40, icon:'github', accent:'var(--acc-github)', accentFg:'var(--acc-github-fg)', label:'GitHub',
    name:'GitHub', sub:'令牌 · 操作权限 · Git 身份与代理' },
  { id:'npm', order:50, icon:'npm', accent:'var(--acc-npm)', accentFg:'var(--acc-npm-fg)', label:'npm',
    name:'npm', sub:'granular token · 注册表与套件包状态' },
];

/* 内容里复用的迷你图表 helper（纯静态，只为对齐视觉） */
const barSeries = (vals) => {
  const max = Math.max(...vals, 1);
  return '<div class="bars">' + vals.map(v =>
    `<div class="barc" title="${v}"><i style="height:${Math.round(v / max * 100)}%"></i></div>`).join('') + '</div>';
};
const sparkMini = (vals, w = 84, h = 20) => {
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`).join(' ');
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
};
const ringSplit = (total, segs) => {
  const s = segs.map(x => `${x.color} ${x.from}% ${x.to}%`).join(', ');
  return `<div class="ring" role="img" aria-label="峰谷成本拆分" style="background:conic-gradient(${s})"><span>${total}</span></div>`;
};

const CONTENT = {
  spark: `
    <div class="subtabbar" role="tablist" aria-label="火花子页">
      <button class="subtab on" data-subtab="spark" data-value="sparks" role="tab" aria-selected="true">火花流</button>
      <button class="subtab" data-subtab="spark" data-value="proposals" role="tab" aria-selected="false">涌现提议</button>
      <button class="subtab" data-subtab="spark" data-value="scripts" role="tab" aria-selected="false">脚本目录</button>
      <button class="subtab" data-subtab="spark" data-value="graph" role="tab" aria-selected="false">Graph</button>
    </div>

    <div class="subpane active" data-subtab-pane="spark" data-value="sparks">
      <div class="modbar">
        <span class="living"><span class="d"></span><span class="labsub">实时同步开启</span></span>
        <div class="grow"></div>
        <button class="btn ghost sm" type="button">刷新</button>
        <button class="btn sm" type="button">捕获新火花</button>
      </div>
      <div class="card">
        <div class="label">标题</div>
        <input class="field sm" placeholder="一句话标题（≤ 60 字）" />
        <div class="label">内容</div>
        <textarea class="field" rows="2" placeholder="把灵感写下来…（一句或两句）"></textarea>
        <div class="label">标签（逗号分隔）</div>
        <input class="field sm" placeholder="如 insight, 归档" />
        <div class="fieldrow">
          <select class="sel"><option>项目（推荐）</option><option>会话</option><option>全局</option></select>
          <div class="grow"></div>
          <button class="btn" type="button" style="margin-left:auto">✦ 捕获</button>
        </div>
      </div>
      <div class="modbar">
        <button class="subpill on" type="button">全部</button><button class="subpill" type="button">活跃</button><button class="subpill" type="button">已归档</button>
      </div>
      <div class="card list">
        <div class="row">
          <div class="grow"><div class="ttl">把四象限记忆结构沉淀成一条约束</div>
            <div class="meta">活跃 · 项目 · insight, 归档 · 2 分钟前</div></div>
          <span class="pill">结晶</span><span class="pill">归档</span>
        </div>
        <div class="row">
          <div class="grow"><div class="ttl">价格同步脚本应换成 models.dev 直读</div>
            <div class="meta">活跃 · 全局 · script · 昨天 · <span class="cryst">已结晶</span></div></div>
          <span class="pill">归档</span>
        </div>
        <div class="row off">
          <div class="grow"><div class="ttl">Ginna 模型限流重试的固定姿势</div>
            <div class="meta">已归档 · 项目 · leverage:high · 3 天前</div></div>
          <span class="pill">删除</span>
        </div>
      </div>
    </div>

    <div class="subpane" data-subtab-pane="spark" data-value="proposals">
      <div class="modbar">
        <button class="subpill on" type="button">待决议</button><button class="subpill" type="button">已接受</button><button class="subpill" type="button">已驳回</button>
        <div class="grow"></div>
        <button class="btn sm" type="button">Reflect（跑涌现）</button>
      </div>
      <div class="card list">
        <div class="row">
          <div class="grow"><div class="ttl"><b style="color:var(--acc-spark-fg)">关联</b> · 价格同步 ⟷ models.dev</div>
            <div class="meta">高杠杆 · 82% · 3 spark(s)</div></div>
          <span class="pill">接受</span><span class="pill">驳回</span>
        </div>
        <div class="row">
          <div class="grow"><div class="ttl"><b style="color:var(--acc-spark-fg)">清理</b> · 30 天未引用候选</div>
            <div class="meta">中杠杆 · 64% · 6 spark(s)</div></div>
          <span class="pill">接受</span><span class="pill">驳回</span>
        </div>
      </div>
    </div>

    <div class="subpane" data-subtab-pane="spark" data-value="scripts">
      <div class="modbar">
        <button class="subpill on" type="button">全部</button><button class="subpill" type="button">项目</button><button class="subpill" type="button">全局</button>
      </div>
      <div class="card list">
        <div class="row">
          <div class="grow"><div class="ttl">价格同步 → models.dev 直读</div>
            <div class="meta">项目 · 步骤 4 · 成功率 92% · 调用 12 · 触发: price</div></div>
          <span class="pill">调用</span><span class="pill">＋</span>
        </div>
        <div class="row">
          <div class="grow"><div class="ttl">发布前 typecheck+build+test 三段式</div>
            <div class="meta">全局 · 步骤 3 · 成功率 100% · 调用 8</div></div>
          <span class="pill">调用</span><span class="pill">＋</span>
        </div>
      </div>
    </div>

    <div class="subpane" data-subtab-pane="spark" data-value="graph">
      <div class="card" style="text-align:center">
        <svg viewBox="0 0 360 210" width="100%" height="210" role="img" aria-label="火花关联图">
          <line x1="180" y1="105" x2="180" y2="30" style="stroke:var(--acc-spark)" stroke-width="1.5" stroke-dasharray="6 4" opacity=".55"/>
          <line x1="180" y1="105" x2="280" y2="72" style="stroke:var(--acc-spark)" stroke-width="1.5" stroke-dasharray="6 4" opacity=".55"/>
          <line x1="110" y1="150" x2="320" y2="22" style="stroke:var(--dsw-alias-state-success-primary)" stroke-width="2" opacity=".85"/>
          <circle cx="180" cy="105" r="14" style="fill:var(--dsw-alias-brand-primary)"/><text x="180" y="109" text-anchor="middle" font-size="10" style="fill:var(--dsw-alias-label-primary-foreground)" font-weight="600">四象</text>
          <circle cx="180" cy="20" r="12" style="fill:var(--dsw-alias-brand-primary)"/><text x="180" y="24" text-anchor="middle" font-size="9" style="fill:var(--dsw-alias-label-primary-foreground)">价</text>
          <circle cx="288" cy="62" r="12" style="fill:var(--dsw-alias-brand-primary)"/><text x="288" y="66" text-anchor="middle" font-size="9" style="fill:var(--dsw-alias-label-primary-foreground)">Gin</text>
          <circle cx="110" cy="160" r="12" style="fill:var(--dsw-alias-state-success-primary, #166534)"/><text x="110" y="164" text-anchor="middle" font-size="9" style="fill:var(--dsw-alias-label-primary-foreground)">边</text>
          <circle cx="320" cy="16" r="12" fill="none" style="stroke:var(--dsw-alias-state-success-primary)" stroke-width="1.5"/>
        </svg>
        <div class="legend" style="justify-content:center">
          <span><i style="border-color:var(--dsw-alias-state-success-primary)"></i>已结晶</span>
          <span><i class="dash" style="border-color:var(--acc-spark)"></i>提议关联</span>
        </div>
      </div>
    </div>`,

  hippomemo: `
    <div class="subtabbar" role="tablist" aria-label="记忆子页">
      <button class="subtab on" data-subtab="hippomemo" data-value="overview" role="tab" aria-selected="true">总览</button>
      <button class="subtab" data-subtab="hippomemo" data-value="memories" role="tab" aria-selected="false">记忆</button>
      <button class="subtab" data-subtab="hippomemo" data-value="prefs" role="tab" aria-selected="false">偏好</button>
      <button class="subtab" data-subtab="hippomemo" data-value="evolution" role="tab" aria-selected="false">进化</button>
    </div>

    <div class="subpane active" data-subtab-pane="hippomemo" data-value="overview">
      <div class="card">
        <div class="panelhead"><b>记忆</b><span class="pill">实时</span><span class="labsub" style="margin-left:auto">需要我处理 · 4</span></div>
        <div class="bstrip">
          <button class="bregion" type="button"><i class="sdot done"></i><div>前额叶<span>注入 89 / 抑制 12</span></div></button>
          <button class="bregion" type="button"><i class="sdot done"></i><div>杏仁核<span>识别到 5 偏好</span></div></button>
          <button class="bregion" type="button"><i class="sdot done"></i><div>海马体<span>最近结晶 12</span></div></button>
          <button class="bregion" type="button"><i class="sdot done"></i><div>新皮层<span>264 条记忆</span></div></button>
        </div>
        <div class="narration"><span class="labsub">旁白</span><span>前额叶正为当前话题放行 3 条相关记忆…</span></div>
      </div>
      <div class="hline"><b>最近活动</b><span class="pill">验证</span><span class="labsub">2 分钟前</span></div>
      <div class="card list">
        <div class="row"><div class="grow"><div class="ttl">AI 最近在用</div><div class="meta">注入 3 条 · 前额叶放行</div></div></div>
        <div class="row"><div class="grow"><div class="ttl">引用 1 条</div><div class="meta">「边做边提交」… agent 提到记忆</div></div></div>
      </div>
    </div>

    <div class="subpane" data-subtab-pane="hippomemo" data-value="memories">
      <div class="modbar">
        <input class="field sm" style="flex:1;min-width:0" placeholder="搜索记忆..." />
        <select class="sel"><option>全部类型</option><option>洞见</option><option>决策</option><option>事实</option><option>偏好</option><option>约束</option></select>
      </div>
      <div class="modbar">
        <select class="sel"><option>全部范围</option><option>全局</option><option>工作区</option><option>项目</option></select>
        <select class="sel"><option>全部状态</option><option>活跃</option><option>已归档</option><option>已取代</option><option>候选</option></select>
        <select class="sel"><option>最近更新</option><option>创建时间</option><option>重要性</option><option>标题</option></select>
        <button class="subpill" type="button">↓ 降序</button>
      </div>
      <div class="card list">
        <div class="row">
          <div class="grow"><div class="ttl">dsh 插件开发：边做边提交</div>
            <div class="meta"><span class="pill pref">偏好</span> 全局 · 已证明 · 重要性 0.72 · 今天 14:02</div></div>
          <span class="pill">编辑</span><span class="pill">归档</span>
        </div>
        <div class="row">
          <div class="grow"><div class="ttl">ListRow + SettingsCardHeader 统一复用</div>
            <div class="meta"><span class="pill">决策</span> 工作区 · 重要性 0.58 · 昨天</div></div>
          <span class="pill">编辑</span><span class="pill">归档</span>
        </div>
        <div class="row">
          <div class="grow"><div class="ttl">profile 副本与 workspace lib 是硬链接</div>
            <div class="meta"><span class="pill">事实</span> 工作区 · <span class="pill model">⚙ tencent/hy4-preview</span> · 3 天前</div></div>
          <span class="pill">编辑</span><span class="pill">归档</span>
        </div>
        <div class="row off">
          <div class="grow"><div class="ttl">旧版 price 同步脚本（已取代）</div>
            <div class="meta"><span class="pill">决策</span> 已取代 · 重要性 0.31</div></div>
          <span class="pill">恢复</span><span class="pill">删除</span>
        </div>
      </div>
      <div class="pager"><span>共 264 条</span><span>每页 10</span><span>第 1 / 27 页</span><button class="subpill" type="button">上一页</button><button class="subpill" type="button">下一页</button></div>
    </div>

    <div class="subpane" data-subtab-pane="hippomemo" data-value="prefs">
      <div class="card">
        <div class="panelhead"><b>我的偏好</b><span class="pill pref">偏好</span><span class="labsub" style="margin-left:auto">5 条 · 命中率 82%</span></div>
        <div class="prefmeta">杏仁核 · 自动 · 手敲</div>
        <div class="row" style="padding-left:0;padding-right:0">
          <span class="pill pref">杏仁核 · 自动</span>
          <div class="grow"><div class="ttl">边做边提交</div><div class="meta">命中 41× · 已证明 · 衰减中 2%</div></div>
          <span class="pill">确认</span><span class="pill">修订</span><span class="pill">遗忘</span>
        </div>
        <div class="row" style="padding-left:0;padding-right:0">
          <span class="pill">手敲</span>
          <div class="grow"><div class="ttl">UI 单一强调色</div><div class="meta">命中 18× · 未衰减</div></div>
          <span class="pill">修订</span><span class="pill">遗忘</span>
        </div>
        <div class="row" style="padding-left:0;padding-right:0">
          <span class="pill pref">杏仁核 · 自动</span>
          <div class="grow"><div class="ttl">跑 build 前先看 git status</div><div class="meta">命中 9× · 衰减中 30%</div></div>
          <span class="pill">确认</span><span class="pill">修订</span><span class="pill">遗忘</span>
        </div>
      </div>
    </div>

    <div class="subpane" data-subtab-pane="hippomemo" data-value="evolution">
      <div class="hline"><b>需要我处理</b><span class="pill">行动</span><span class="labsub">4 项</span></div>
      <div class="card list">
        <div class="row"><i class="sdot error"></i><div class="grow"><div class="ttl">tencent 429 诊断临时结论即将失效</div><div class="meta"><span class="pill">过期</span> 3 分钟后 · 2 分钟前</div></div><span class="pill">归档</span></div>
        <div class="row"><i class="sdot warn"></i><div class="grow"><div class="ttl">「价格同步」疑似重复 ×4</div><div class="meta"><span class="pill">疑似重复</span> 3 分钟前</div></div><span class="pill">合并</span></div>
        <div class="row"><i class="sdot warn"></i><div class="grow"><div class="ttl">观察期噪声候选 6 条</div><div class="meta"><span class="pill">观察中</span> 昨天</div></div><span class="pill">自动</span></div>
        <div class="row"><i class="sdot warn"></i><div class="grow"><div class="ttl">「不要每次都重跑 install」待审</div><div class="meta"><span class="pill">偏好待审</span> 2 小时前</div></div><span class="pill">确认</span></div>
      </div>
      <div class="card">
        <div class="grid2">
          <span class="labsub">共 264 · 活跃 238 · 归档 26</span>
          <span class="labsub">被召回 201 · 引用率 61%</span>
          <span class="labsub">从未召回 51 · 30 天未召回 6</span>
          <span class="labsub">召回→引用转化 44%</span>
        </div>
      </div>
      <div class="modbar">
        <button class="btn sm" type="button">预演检查</button>
        <button class="btn ghost sm" type="button">运行并应用</button>
        <span class="labsub">最近运行：昨天 · 预演（未写入）· 动作 3 · LLM 复核 2</span>
      </div>
    </div>`,

  finance: `
    <div class="modbar">
      <span class="labsub">最后更新 3 分钟前</span><span class="labsub" style="color:var(--dsw-alias-state-warn-primary)">价格表已 4 小时未同步</span>
      <div class="grow"></div>
      <button class="btn ghost sm" type="button">刷新</button>
    </div>
    <div class="hline"><b>余额总览</b></div>
    <div class="card list">
      <div class="row"><i class="sdot done"></i><div class="grow"><div class="ttl">deepseek-official <span class="labsub">host 元数据</span></div><div class="meta"><span class="pill">永久</span> 剩余 42% · 历史充值 ¥ 200.00</div></div><b style="font-size:13px">¥ 84.11</b></div>
      <div class="row"><i class="sdot done"></i><div class="grow"><div class="ttl">anthropic <span class="labsub">账本识别</span></div><div class="meta"><span class="pill">剩余 18 天</span> 历史充值 $ 50.00</div></div><b style="font-size:13px">$ 31.04</b></div>
      <div class="row"><i class="sdot warn"></i><div class="grow"><div class="ttl">openai <span class="labsub">用户配置</span></div><div class="meta"><span class="muted">API key 未配置</span></div></div><b style="font-size:13px">—</b></div>
    </div>

    <div class="stats cols-4">
      <div class="stat"><div class="k">输入 Tokens</div><div class="v">12.4M</div><div class="d">${sparkMini([3,4,4,5,6,6,8,7,9,10,11,11,13,14])}</div></div>
      <div class="stat"><div class="k">输出 Tokens</div><div class="v">3.1M</div><div class="d">${sparkMini([1,1,1,2,2,2,3,2,3,3,4,3,4,5])}</div></div>
      <div class="stat"><div class="k">会话</div><div class="v">3,182</div></div>
      <div class="stat"><div class="k">工作区</div><div class="v">4</div></div>
    </div>
    <div class="stats cols-2">
      <div class="stat"><div class="k">按量支出</div><div class="v">¥ 32.18</div><div class="d muted">真实从充值钱包扣除</div></div>
      <div class="stat"><div class="k">订阅等价</div><div class="v">¥ 61.02</div><div class="d muted">目录价 · 非真实支出</div></div>
    </div>

    <div class="hline"><b>峰谷成本拆分</b><span class="labsub">高峰 9–12 · 14–18 北京时间</span></div>
    <div class="card">
      <div class="ringwrap">
        ${ringSplit('¥32.18', [
          { color:'var(--acc-spark)', from:0, to:52 },
          { color:'var(--acc-finance)', from:52, to:71 },
          { color:'var(--dsw-alias-label-tertiary)', from:71, to:88 },
          { color:'var(--dsw-alias-border-l2)', from:88, to:100 },
        ])}
        <div class="split-leg">
          <span class="sl"><span class="sq" style="background:var(--acc-spark)"></span>高峰 ¥ 16.74</span>
          <span class="sl"><span class="sq" style="background:var(--acc-finance)"></span>空闲 ¥ 6.12</span>
          <span class="sl"><span class="sq" style="background:var(--dsw-alias-label-tertiary)"></span>生效前 ¥ 5.46</span>
          <span class="sl"><span class="sq" style="background:var(--dsw-alias-border-l2)"></span>未细分 ¥ 3.86</span>
          <span class="labsub" style="margin-top:4px">错峰可省 ¥ 5.88 · 占高峰 35%</span>
        </div>
      </div>
    </div>

    <div class="hline"><b>近 24 小时成本分布</b><span class="labsub">北京时区</span></div>
    <div class="card">${barSeries([0,0,0,0,0,0,1,3,6,14,22,18,9,3,2,5,12,18,24,19,11,7,4,2])}<div class="labsub" style="margin-top:6px">高峰 9:00–12:00 · 14:00–18:00</div></div>

    <div class="hline"><b>按供应商成本</b><span class="labsub">3 个供应商</span></div>
    <div class="card list">
      <div class="row" style="--accent:var(--acc-finance)"><div class="grow"><div class="ttl">deepseek-official</div><div class="bar" style="margin-top:5px"><i style="width:64%"></i></div></div><b style="font-size:12px">¥ 24.90</b></div>
      <div class="row"><div class="grow"><div class="ttl">anthropic</div><div class="bar" style="margin-top:5px"><i style="width:22%;background:var(--dsw-alias-label-tertiary)"></i></div></div><b style="font-size:12px">¥ 9.11</b></div>
      <div class="row"><div class="grow"><div class="ttl">openai</div><div class="bar" style="margin-top:5px"><i style="width:12%;background:var(--dsw-alias-label-tertiary)"></i></div></div><b style="font-size:12px">¥ 4.41</b></div>
    </div>

    <div class="hline"><b>按模型成本</b><span class="labsub">总 ¥ 32.18</span></div>
    <div class="card list" style="padding:6px 10px">
      <table class="table">
        <thead><tr><th>模型</th><th class="num">费用</th><th class="num">输入 token</th><th class="num">输出 token</th></tr></thead>
        <tbody>
          <tr><td>deepseek/deepseek-v4-pro</td><td class="num">¥ 15.20</td><td class="num">9.1M</td><td class="num">2.3M</td></tr>
          <tr><td>tencent/hy4-preview</td><td class="num">¥ 8.32</td><td class="num">2.9M</td><td class="num">0.6M</td></tr>
          <tr><td>anthropic/claude-sonnet</td><td class="num">¥ 6.05</td><td class="num">0.4M</td><td class="num">0.2M</td></tr>
        </tbody>
      </table>
    </div>`,

  github: `
    <div class="card">
      <div class="row" style="padding-left:0;padding-top:0"><i class="sdot done"></i><div class="grow"><div class="ttl">已连接为</div></div><span class="pill">neil-ji</span><span class="pill">Neil</span></div>
      <div class="pillwrap"><span class="pill">repo</span><span class="pill">workflow</span><span class="pill">read:org</span><span class="pill">gist</span></div>
      <button class="btn ghost sm" type="button" style="width:100%">测试连接</button>
    </div>
    <div class="card">
      <div class="row" style="padding-left:0;padding-top:0"><i class="sdot done"></i><div class="grow"><div class="ttl">已配置</div><div class="meta">来源：credential store</div></div></div>
      <div class="fieldrow">
        <input class="field sm" style="flex:1;min-width:0" type="password" placeholder="粘贴 GitHub 访问令牌（PAT）" />
        <button class="btn sm" type="button">保存令牌</button>
        <button class="btn ghost sm" type="button">移除令牌</button>
      </div>
    </div>
    <div class="card">
      <div class="hline" style="margin:0 0 4px"><b>操作权限</b></div>
      <label class="check"><input type="checkbox" checked> 创建仓库</label>
      <label class="check"><input type="checkbox" checked> 推送代码</label>
      <label class="check"><input type="checkbox" checked> 拉取代码</label>
      <label class="check"><input type="checkbox" checked> 创建 PR</label>
      <label class="check"><input type="checkbox" checked> 代码审查</label>
      <label class="check"><input type="checkbox" checked> 发布 Pages 站点</label>
      <label class="check"><input type="checkbox" checked> 触发 Actions 工作流</label>
      <label class="check"><input type="checkbox" checked> Issue 与评论</label>
      <label class="check"><input type="checkbox" checked> 发布 Release</label>
      <div class="labsub" style="margin-top:4px">强制推送 / 删除仓库·分支 — 不可用（本连接器未提供）</div>
    </div>
    <div class="card">
      <div class="hline" style="margin:0 0 4px"><b>Git 身份与默认值</b></div>
      <div class="label">用户名</div><input class="field sm" value="neil" />
      <div class="label">邮箱</div><input class="field sm" value="neil@example.com" />
      <div class="label">默认可见性</div>
      <select class="sel" style="width:100%"><option>私有</option><option>公开</option></select>
      <div class="label">Git 代理</div>
      <div class="fieldrow"><input class="field sm" style="flex:1;min-width:0" placeholder="如 http://127.0.0.1:7897，留空直连" /><button class="btn ghost sm" type="button">测试代理</button></div>
    </div>`,

  npm: `
    <div class="card">
      <div class="row" style="padding-left:0;padding-top:0"><i class="sdot done"></i><div class="grow"><div class="ttl">已连接账号</div><div class="meta">granular · 绕过 2FA</div></div><span class="pill">neilji</span></div>
      <div class="fieldrow">
        <input class="field sm" style="flex:1;min-width:0" type="password" placeholder="粘贴 granular token（只写不回显）" />
        <button class="btn sm" type="button">保存</button>
        <button class="btn ghost sm" type="button">移除</button>
      </div>
      <div class="labsub" style="margin-top:8px">granular token 就绪：npm_publish / npm_dist_tag / npm_deprecate / npm_trust 全自动可用；npm_launch 一键首发 + trust + tag。</div>
    </div>
    <div class="card">
      <div class="row" style="padding-left:0;padding-top:0"><i class="sdot done"></i><div class="grow"><div class="ttl">npm 注册表</div><div class="meta">registry.npmjs.org</div></div><span class="pill">可达</span></div>
      <div class="hline" style="margin:8px 0 4px"><b>套件包状态</b></div>
      <div class="row" style="padding-left:0;padding-right:0"><i class="sdot done"></i><div class="grow"><div class="ttl"><code class="code">dsh-spark-finance</code></div></div><span class="labsub">已发布 · 最新 0.4.0</span></div>
      <div class="row" style="padding-left:0;padding-right:0"><i class="sdot done"></i><div class="grow"><div class="ttl"><code class="code">dsh-spark-plugin-kit</code></div></div><span class="labsub">已发布 · 最新 0.1.0</span></div>
      <div class="row" style="padding-left:0;padding-right:0"><i class="sdot done"></i><div class="grow"><div class="ttl"><code class="code">dsh-hippomemo</code></div></div><span class="labsub">已发布 · 最新 0.2.6</span></div>
      <div class="row" style="padding-left:0;padding-right:0"><i class="sdot error"></i><div class="grow"><div class="ttl"><code class="code">dsh-spark-dock</code></div></div><span class="labsub">未发布</span></div>
      <button class="btn ghost sm" type="button" style="width:100%;margin-top:6px">重试</button>
    </div>`,
};
