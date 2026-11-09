import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Locale = "zh" | "en";

const en = {
  "home.projects": "Projects",
  "home.storageTotal": "{size} total",
  "home.search": "Search projects",
  "home.sort.label": "Sort projects",
  "home.sort.activity": "Recent activity",
  "home.sort.name": "Name",
  "home.sort.size": "Size",
  "home.noMatch": "No matching projects",
  "home.loading": "Loading projects",
  "home.retry": "Retry",
  "project.lastActivity": "Active {time}",
  "project.open": "Open",
  "project.downloadLatest": "Download latest export",
  "project.delete": "Delete project",
  "project.deleting": "Deleting…",
  "project.deleted": "Deleted {name}",
  "project.deleteFailed": "Could not delete: {error}",
  "project.missing": "Project no longer exists",
  "project.menu": "Project actions",
  "project.status.analyzing": "Analyzing {percent}",
  "project.status.new": "Not analyzed",
  "project.status.analysis_failed": "Analysis failed",
  "project.status.analysis_cancelled": "Analysis cancelled",
  "project.status.no_people": "No people found",
  "project.status.exporting": "Exporting {percent}",
  "project.status.choose_person": "Choose a person",
  "project.status.exported": "Exported",
  "project.status.editing": "Editing · {person_label} r{ordinal}",
  "delete.title": "Delete “{name}”?",
  "delete.body":
    "This permanently deletes the source video, analysis, {revisions} revisions and all exports, freeing {size}. This cannot be undone.",
  "delete.activeJobs": "Running {kinds} jobs will be cancelled.",
  "delete.confirm": "Delete",
  "delete.cancel": "Cancel",
  "queue.open": "Open",

  "app.tagline": "Masked Identity Rendering And Isolation",
  "app.footer": "Audio is preserved and is not anonymized. Uncertain pixels stay hidden.",
  "lang.switch": "中文",
  "lang.switchLabel": "Switch language",

  "step.upload": "Video",
  "step.analyze": "Analyze",
  "step.select": "Choose person",
  "step.edit": "Edit & export",

  "health.ready": "Engine ready",
  "health.degraded": "Engine degraded",
  "health.down": "Backend offline",
  "health.connecting": "Connecting…",
  "health.detail": "FFmpeg {ffmpeg} · FFprobe {ffprobe} · CUDA {cuda}",
  "health.ok": "ok",
  "health.missing": "missing",
  "health.cudaOn": "available",
  "health.cudaOff": "unavailable (CPU fallback)",

  "queue.button": "Jobs",
  "queue.title": "Processing jobs",
  "queue.close": "Close",
  "queue.empty": "No jobs yet. Uploads, analyses, and exports appear here.",
  "queue.unavailable": "Queue unavailable: {error}",
  "queue.cancel": "Cancel",
  "queue.cancelling": "Cancelling…",
  "queue.download": "Download",
  "queue.activeCount": "{count} running",

  "kind.analysis": "Analysis",
  "kind.preview": "Preview",
  "kind.render": "Export",

  "status.queued": "Queued",
  "status.running": "Running",
  "status.succeeded": "Done",
  "status.failed": "Failed",
  "status.cancelled": "Cancelled",

  "stage.queued": "Waiting for worker",
  "stage.leased": "Starting",
  "stage.proxy": "Preparing proxy",
  "stage.detect_track": "Detecting & tracking people",
  "stage.render": "Rendering frames",
  "stage.mux": "Encoding & muxing audio",
  "stage.complete": "Complete",
  "stage.cancelled": "Cancelled",
  "stage.failed": "Failed",

  "upload.title": "Start with a video",
  "upload.lead": "MIRAI finds every person, lets you choose one to keep, and hides everyone else.",
  "upload.drop": "Drop a video here",
  "upload.or": "or click to browse",
  "upload.formats": "MP4, MOV, MKV · up to 30 min · 1080p recommended",
  "upload.uploading": "Uploading {name}",
  "upload.cancel": "Cancel upload",
  "upload.cancelled": "Upload cancelled.",
  "upload.failed": "Upload failed: {error}",
  "upload.fact1Title": "Runs locally",
  "upload.fact1": "Video never leaves this machine.",
  "upload.fact2Title": "Fails closed",
  "upload.fact2": "Anything uncertain is hidden by default.",
  "upload.fact3Title": "Audio untouched",
  "upload.fact3": "Sound is kept as-is and not anonymized.",
  "upload.resume": "Continue with {name}",

  "analyze.title": "Analyzing people",
  "analyze.lead":
    "Detecting, tracking, and grouping every person in the video. You can leave this page; the job keeps running.",
  "analyze.start": "Start analysis",
  "analyze.retry": "Retry analysis",
  "analyze.failed": "Analysis failed",
  "analyze.cancelled": "Analysis was cancelled.",
  "analyze.waiting": "Queued — waiting for the worker",
  "analyze.done": "Analysis complete. Loading people…",
  "analyze.meta.resolution": "Resolution",
  "analyze.meta.duration": "Duration",
  "analyze.meta.size": "Size",
  "analyze.meta.codec": "Codec",
  "analyze.meta.audio": "Audio",
  "analyze.meta.noAudio": "None",
  "analyze.newVideo": "Use a different video",
  "analyze.stage.group": "Grouping identities",

  "select.title": "Who stays visible?",
  "select.lead": "Choose one person. Everyone else in {name} will be mosaicked and blurred.",
  "select.empty": "No people were found in this video.",
  "select.reanalyze": "Run analysis again",
  "select.onScreen": "{time} on screen",
  "select.appearances": "{count} appearances",
  "select.stat.screen": "Screen time",
  "select.stat.appearances": "Appearances",
  "select.stat.confidence": "Match confidence",
  "select.uncertain": "{count} uncertain",
  "select.confirm": "Keep {name} visible",
  "select.creating": "Creating selection…",
  "select.pick": "Select a person to see details",
  "select.resumeTitle": "Continue where you left off",
  "select.resume": "Resume {name} · r{ordinal}",
  "select.uncertainNote":
    "Uncertain appearances stay hidden unless you include them while editing.",

  "editor.keeping": "Keeping",
  "editor.revision": "Revision r{ordinal}",
  "editor.undo": "Undo",
  "editor.undoHint": "Undo last change (⌘Z / Ctrl+Z)",
  "editor.switchPerson": "Change person",
  "editor.loading": "Loading revision…",
  "editor.tab.corrections": "Corrections",
  "editor.tab.settings": "Look",
  "editor.tab.export": "Export",
  "editor.tab.history": "History",

  "tool.keep": "Keep",
  "tool.hide": "Hide",
  "tool.point": "Point",
  "tool.box": "Box",
  "tool.polarity": "Prompt polarity",
  "tool.shape": "Prompt shape",
  "tool.hintPoint": "Click on the frame to mark what to {action}.",
  "tool.hintBox": "Drag on the frame to box what to {action}.",
  "tool.keys": "V point · B box · X keep/hide · Alt inverts",
  "tool.actionKeep": "keep clear",
  "tool.actionHide": "hide",
  "tool.overlay": "Prompt canvas. Click to add a point or drag to draw a box.",
  "tool.dragBox": "Drag to draw a box, or press V for point mode.",
  "tool.promptSaved": "{polarity} {shape} added · r{ordinal}",
  "tool.promptFailed": "Could not save prompt: {error}",

  "player.play": "Play",
  "player.pause": "Pause",
  "player.back": "Back 1 s",
  "player.forward": "Forward 1 s",
  "player.mute": "Mute",
  "player.unmute": "Unmute",
  "player.unavailable": "The preview proxy is not available for this video.",

  "timeline.title": "Timeline",
  "timeline.loading": "Loading timeline…",
  "timeline.failed": "Could not load the timeline: {error}",
  "timeline.hint": "Click to seek · drag across tracks to select a range · ←/→ to step",
  "timeline.legend.selected": "Kept person",
  "timeline.legend.ambiguous": "Uncertain",
  "timeline.legend.other": "Others (hidden)",
  "timeline.legend.include": "Included by you",
  "timeline.legend.exclude": "Excluded by you",
  "timeline.empty": "No detections",
  "timeline.noDuration": "No duration information",
  "timeline.aria": "Detection timeline. Click to seek, drag to select a range, arrow keys step.",
  "timeline.track": "Track #{n}",

  "corr.title": "Who is visible in a time range",
  "corr.empty": "Drag across the timeline to pick a range, or use a shortcut:",
  "corr.aroundPlayhead": "±2 s around playhead",
  "corr.wholeVideo": "Whole video",
  "corr.range": "{start} – {end}",
  "corr.clear": "Clear",
  "corr.noTracks": "No one is detected in this range.",
  "corr.detections": "{count} frames",
  "corr.keep": "Visible",
  "corr.hide": "Hidden",
  "corr.kind.selected": "Kept person",
  "corr.kind.ambiguous": "Uncertain",
  "corr.kind.other": "Other",
  "corr.saved": "{track} set to {decision} · r{ordinal}",
  "corr.failed": "Could not save correction: {error}",
  "corr.history": "Saved corrections",
  "corr.historyEmpty": "No corrections yet.",
  "corr.jump": "Jump to range",

  "settings.groupEffect": "Hiding effect",
  "settings.groupMask": "Mask boundary",
  "settings.mosaic": "Mosaic block",
  "settings.mosaicHelp": "Larger blocks hide more detail.",
  "settings.blur": "Blur strength",
  "settings.blurHelp": "Gaussian blur applied over the mosaic.",
  "settings.margin": "Edge margin",
  "settings.marginHelp": "Negative shrinks the clear area; positive expands it (expert).",
  "settings.smoothing": "Edge feather",
  "settings.smoothingHelp": "Softens the transition at the mask edge.",
  "settings.threshold": "Mask confidence",
  "settings.thresholdHelp":
    "Pixels below this confidence stay hidden. Under 0.70 needs expert mode.",
  "settings.mode": "Privacy mode",
  "settings.safe": "Safe",
  "settings.expert": "Expert",
  "settings.warning":
    "These values expose more pixels than the safe defaults and weaken privacy protection.",
  "settings.ack": "I understand and accept the reduced protection.",
  "settings.needExpert": "Switch to Expert and confirm to apply.",
  "settings.apply": "Apply",
  "settings.applying": "Applying…",
  "settings.reset": "Reset",
  "settings.defaults": "Restore defaults",
  "settings.dirty": "Unapplied changes",
  "settings.note": "Applying creates a new revision. Your corrections are kept.",
  "settings.applied": "Settings applied · r{ordinal}",
  "settings.failed": "Could not apply settings: {error}",

  "export.previewTitle": "Quick preview",
  "export.previewHelp": "Renders a short sample so you can check the result.",
  "export.previewStart": "Generate preview",
  "export.renderTitle": "Full export",
  "export.renderHelp":
    "Renders the whole video with only {name} clear, then muxes the original audio.",
  "export.renderStart": "Export video",
  "export.rerun": "Run again",
  "export.download": "Download video",
  "export.stale": "Made from r{ordinal} — newer edits not included",
  "export.current": "Up to date",
  "export.queued": "{kind} queued.",
  "export.failedStart": "Could not start {kind}: {error}",

  "history.title": "Revision history",
  "history.current": "Current",
  "history.restore": "Restore",
  "history.restored": "Restored r{ordinal}. New edits continue from here.",
  "history.change.selection": "Person selected",
  "history.change.settings": "Settings changed",
  "history.change.override": "Range corrected",
  "history.change.prompt": "Mask prompt added",

  "toast.dismiss": "Dismiss",
  "toast.jobDone": "{kind} finished for {name}.",
  "toast.jobFailed": "{kind} failed for {name}: {error}",
  "toast.selectionFailed": "Could not create selection: {error}",
  "toast.cancelFailed": "Could not cancel job: {error}",
  "toast.loadFailed": "Could not load: {error}",
  "common.unknownError": "Unknown error",
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const zh: Dictionary = {
  "home.projects": "项目",
  "home.storageTotal": "共 {size}",
  "home.search": "搜索项目",
  "home.sort.label": "排序",
  "home.sort.activity": "最近活动",
  "home.sort.name": "名称",
  "home.sort.size": "占用空间",
  "home.noMatch": "没有匹配的项目",
  "home.loading": "正在加载项目",
  "home.retry": "重试",
  "project.lastActivity": "最近活动于 {time}",
  "project.open": "打开",
  "project.downloadLatest": "下载最新导出",
  "project.delete": "删除项目",
  "project.deleting": "正在删除…",
  "project.deleted": "已删除 {name}",
  "project.deleteFailed": "删除失败：{error}",
  "project.missing": "项目不存在或已被删除",
  "project.menu": "项目操作",
  "project.status.analyzing": "分析中 {percent}",
  "project.status.new": "待分析",
  "project.status.analysis_failed": "分析失败",
  "project.status.analysis_cancelled": "分析已取消",
  "project.status.no_people": "未检测到人物",
  "project.status.exporting": "导出中 {percent}",
  "project.status.choose_person": "待选择人物",
  "project.status.exported": "已导出",
  "project.status.editing": "编辑中 · {person_label} r{ordinal}",
  "delete.title": "删除“{name}”？",
  "delete.body":
    "将永久删除源视频、分析结果、{revisions} 个版本和所有导出文件，共释放 {size}。此操作无法撤销。",
  "delete.activeJobs": "正在进行的{kinds}任务会被取消。",
  "delete.confirm": "删除",
  "delete.cancel": "取消",
  "queue.open": "打开",

  "app.tagline": "人物身份遮蔽与隔离",
  "app.footer": "音频会原样保留，不做匿名化处理；所有不确定的像素默认遮蔽。",
  "lang.switch": "EN",
  "lang.switchLabel": "切换语言",

  "step.upload": "视频",
  "step.analyze": "分析",
  "step.select": "选择人物",
  "step.edit": "编辑与导出",

  "health.ready": "引擎就绪",
  "health.degraded": "引擎异常",
  "health.down": "后端离线",
  "health.connecting": "连接中…",
  "health.detail": "FFmpeg {ffmpeg} · FFprobe {ffprobe} · CUDA {cuda}",
  "health.ok": "正常",
  "health.missing": "缺失",
  "health.cudaOn": "可用",
  "health.cudaOff": "不可用（使用 CPU）",

  "queue.button": "任务",
  "queue.title": "处理任务",
  "queue.close": "关闭",
  "queue.empty": "暂无任务。上传、分析和导出任务会显示在这里。",
  "queue.unavailable": "无法获取任务队列：{error}",
  "queue.cancel": "取消",
  "queue.cancelling": "正在取消…",
  "queue.download": "下载",
  "queue.activeCount": "{count} 个进行中",

  "kind.analysis": "分析",
  "kind.preview": "预览",
  "kind.render": "导出",

  "status.queued": "排队中",
  "status.running": "进行中",
  "status.succeeded": "已完成",
  "status.failed": "失败",
  "status.cancelled": "已取消",

  "stage.queued": "等待处理",
  "stage.leased": "正在启动",
  "stage.proxy": "生成代理视频",
  "stage.detect_track": "检测并跟踪人物",
  "stage.render": "渲染画面",
  "stage.mux": "编码并合成音频",
  "stage.complete": "已完成",
  "stage.cancelled": "已取消",
  "stage.failed": "失败",

  "upload.title": "从一段视频开始",
  "upload.lead": "MIRAI 会找出画面中的每个人，由你选定一位保留，其余人全部遮蔽。",
  "upload.drop": "将视频拖到这里",
  "upload.or": "或点击选择文件",
  "upload.formats": "支持 MP4、MOV、MKV · 最长 30 分钟 · 建议 1080p",
  "upload.uploading": "正在上传 {name}",
  "upload.cancel": "取消上传",
  "upload.cancelled": "已取消上传。",
  "upload.failed": "上传失败：{error}",
  "upload.fact1Title": "本地处理",
  "upload.fact1": "视频不会离开这台机器。",
  "upload.fact2Title": "默认遮蔽",
  "upload.fact2": "任何不确定的像素都会被隐藏。",
  "upload.fact3Title": "音频不处理",
  "upload.fact3": "声音原样保留，不做匿名化。",
  "upload.resume": "继续处理 {name}",

  "analyze.title": "正在分析人物",
  "analyze.lead": "正在检测、跟踪并归类视频中的每个人。可以离开此页面，任务会在后台继续。",
  "analyze.start": "开始分析",
  "analyze.retry": "重新分析",
  "analyze.failed": "分析失败",
  "analyze.cancelled": "分析已取消。",
  "analyze.waiting": "已排队，等待处理",
  "analyze.done": "分析完成，正在加载人物…",
  "analyze.meta.resolution": "分辨率",
  "analyze.meta.duration": "时长",
  "analyze.meta.size": "大小",
  "analyze.meta.codec": "编码",
  "analyze.meta.audio": "音频",
  "analyze.meta.noAudio": "无",
  "analyze.newVideo": "换一个视频",
  "analyze.stage.group": "归类人物身份",

  "select.title": "保留谁？",
  "select.lead": "选择一个人。{name} 中的其他人都会被马赛克并模糊处理。",
  "select.empty": "视频中没有检测到人物。",
  "select.reanalyze": "重新分析",
  "select.onScreen": "出镜 {time}",
  "select.appearances": "出现 {count} 次",
  "select.stat.screen": "出镜时长",
  "select.stat.appearances": "出现次数",
  "select.stat.confidence": "匹配置信度",
  "select.uncertain": "{count} 处不确定",
  "select.confirm": "保留 {name}",
  "select.creating": "正在创建…",
  "select.pick": "选择一个人物查看详情",
  "select.resumeTitle": "继续上次的编辑",
  "select.resume": "继续编辑 {name} · r{ordinal}",
  "select.uncertainNote": "不确定的片段默认遮蔽，可在编辑时手动纳入。",

  "editor.keeping": "保留",
  "editor.revision": "版本 r{ordinal}",
  "editor.undo": "撤销",
  "editor.undoHint": "撤销上一步（⌘Z / Ctrl+Z）",
  "editor.switchPerson": "更换人物",
  "editor.loading": "正在加载版本…",
  "editor.tab.corrections": "修正",
  "editor.tab.settings": "效果",
  "editor.tab.export": "导出",
  "editor.tab.history": "历史",

  "tool.keep": "保留",
  "tool.hide": "遮蔽",
  "tool.point": "点",
  "tool.box": "框",
  "tool.polarity": "标注类型",
  "tool.shape": "标注形状",
  "tool.hintPoint": "在画面上点击，标记需要{action}的区域。",
  "tool.hintBox": "在画面上拖动，框选需要{action}的区域。",
  "tool.keys": "V 点 · B 框 · X 切换保留/遮蔽 · 按住 Alt 临时反转",
  "tool.actionKeep": "保留清晰",
  "tool.actionHide": "遮蔽",
  "tool.overlay": "标注画布。点击添加点，拖动绘制框。",
  "tool.dragBox": "请拖动绘制框，或按 V 切换到点模式。",
  "tool.promptSaved": "已添加{polarity}{shape} · r{ordinal}",
  "tool.promptFailed": "标注保存失败：{error}",

  "player.play": "播放",
  "player.pause": "暂停",
  "player.back": "后退 1 秒",
  "player.forward": "前进 1 秒",
  "player.mute": "静音",
  "player.unmute": "取消静音",
  "player.unavailable": "该视频的预览代理文件不可用。",

  "timeline.title": "时间轴",
  "timeline.loading": "正在加载时间轴…",
  "timeline.failed": "时间轴加载失败：{error}",
  "timeline.hint": "点击跳转 · 在轨道上拖动选择时间段 · ←/→ 逐步移动",
  "timeline.legend.selected": "保留的人物",
  "timeline.legend.ambiguous": "不确定",
  "timeline.legend.other": "其他人（遮蔽）",
  "timeline.legend.include": "手动纳入",
  "timeline.legend.exclude": "手动排除",
  "timeline.empty": "没有检测结果",
  "timeline.noDuration": "缺少时长信息",
  "timeline.aria": "检测时间轴。点击跳转，拖动选择时间段，方向键逐步移动。",
  "timeline.track": "轨迹 #{n}",

  "corr.title": "时间段内谁可见",
  "corr.empty": "在时间轴上拖动选择时间段，或使用快捷范围：",
  "corr.aroundPlayhead": "播放头前后 2 秒",
  "corr.wholeVideo": "整段视频",
  "corr.range": "{start} – {end}",
  "corr.clear": "清除",
  "corr.noTracks": "该时间段内没有检测到人物。",
  "corr.detections": "{count} 帧",
  "corr.keep": "可见",
  "corr.hide": "遮蔽",
  "corr.kind.selected": "保留人物",
  "corr.kind.ambiguous": "不确定",
  "corr.kind.other": "其他人",
  "corr.saved": "{track} 已设为{decision} · r{ordinal}",
  "corr.failed": "修正保存失败：{error}",
  "corr.history": "已保存的修正",
  "corr.historyEmpty": "还没有修正。",
  "corr.jump": "跳到该时间段",

  "settings.groupEffect": "遮蔽效果",
  "settings.groupMask": "掩膜边界",
  "settings.mosaic": "马赛克块大小",
  "settings.mosaicHelp": "块越大，隐藏的细节越多。",
  "settings.blur": "模糊强度",
  "settings.blurHelp": "叠加在马赛克上的高斯模糊。",
  "settings.margin": "边缘外扩",
  "settings.marginHelp": "负值收缩清晰区域；正值外扩（需专家模式）。",
  "settings.smoothing": "边缘羽化",
  "settings.smoothingHelp": "让掩膜边缘的过渡更柔和。",
  "settings.threshold": "掩膜置信度",
  "settings.thresholdHelp": "低于该置信度的像素保持遮蔽。低于 0.70 需专家模式。",
  "settings.mode": "隐私模式",
  "settings.safe": "安全",
  "settings.expert": "专家",
  "settings.warning": "当前参数会比安全默认值暴露更多像素，隐私保护会减弱。",
  "settings.ack": "我了解并接受减弱的保护。",
  "settings.needExpert": "请切换到专家模式并勾选确认后再应用。",
  "settings.apply": "应用",
  "settings.applying": "正在应用…",
  "settings.reset": "撤销改动",
  "settings.defaults": "恢复默认",
  "settings.dirty": "有未应用的改动",
  "settings.note": "应用后会创建一个新版本，已有的修正会全部保留。",
  "settings.applied": "参数已应用 · r{ordinal}",
  "settings.failed": "参数应用失败：{error}",

  "export.previewTitle": "快速预览",
  "export.previewHelp": "渲染一小段样片，用来检查效果。",
  "export.previewStart": "生成预览",
  "export.renderTitle": "完整导出",
  "export.renderHelp": "渲染整段视频，仅保留 {name} 清晰，并合成原始音频。",
  "export.renderStart": "导出视频",
  "export.rerun": "重新生成",
  "export.download": "下载视频",
  "export.stale": "基于 r{ordinal} 生成，不包含之后的改动",
  "export.current": "已是最新",
  "export.queued": "{kind}任务已排队。",
  "export.failedStart": "无法启动{kind}：{error}",

  "history.title": "版本历史",
  "history.current": "当前",
  "history.restore": "回到此版本",
  "history.restored": "已回到 r{ordinal}，之后的修改将从这里继续。",
  "history.change.selection": "选定人物",
  "history.change.settings": "修改参数",
  "history.change.override": "修正时间段",
  "history.change.prompt": "添加标注",

  "toast.dismiss": "关闭",
  "toast.jobDone": "{name} 的{kind}已完成。",
  "toast.jobFailed": "{name} 的{kind}失败：{error}",
  "toast.selectionFailed": "无法创建选择：{error}",
  "toast.cancelFailed": "无法取消任务：{error}",
  "toast.loadFailed": "加载失败：{error}",
  "common.unknownError": "未知错误",
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, zh };
const STORAGE_KEY = "mirai.locale";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

function initialLocale(): Locale {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "zh" || saved === "en") {
    return saved;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

interface I18nApi {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nApi>({
  locale: "en",
  setLocale: () => undefined,
  t: (key, vars) => translate("en", key, vars),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    setLocaleState(next);
  }, []);

  const api = useMemo<I18nApi>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  return useContext(I18nContext);
}

/** Localized label for a backend job stage; unknown stages fall back to the raw value. */
export function stageLabel(t: Translate, stage: string): string {
  const key = `stage.${stage}` as MessageKey;
  return key in en ? t(key) : stage;
}

export function kindLabel(t: Translate, kind: string): string {
  const key = `kind.${kind}` as MessageKey;
  return key in en ? t(key) : kind;
}

export function statusLabel(t: Translate, status: string): string {
  const key = `status.${status}` as MessageKey;
  return key in en ? t(key) : status;
}
