# 规格：项目列表与视频删除

> 状态：待实现 · 优先级 P0 · 起草于 2026-11-09 · 基线提交 `344fbef`
> 所属路线图：[`docs/ux-roadmap.md`](../ux-roadmap.md) 第 0 项

本文档写给实现者（人或代理）。文中给出了接口、数据流、文件改动清单、测试和验收标准，按顺序实现即可。如果遇到与本文档冲突的现有代码，以 `AGENTS.md` 中的不变量为准，并在提交说明里注明偏离之处。

---

## 1. 背景与问题

1. **无法回到旧视频。**
   - 后端没有列出视频的接口。
   - 前端只在 `localStorage` 的 `mirai.videoId` 中记住"最后一个"视频（见 `web/src/App.tsx` 的 reload-resume 逻辑）。
   - 用户一旦上传了新视频，之前的视频在界面上就再也找不到了，但它们的文件仍然留在磁盘上。
2. **无法删除。**
   - 每个视频会在 `var/projects/<video_id>/` 下留下源文件、代理视频、缩略图、预览和导出结果，可能占用数 GB 空间。
   - 用户只能手动删除目录，而这样会让数据库和文件不一致。
3. **视频状态不可靠（已有 bug）。**
   - `src/figure_detection/worker/main.py` 中，任何任务失败时都会执行 `video.state = VideoState.FAILED`，包括预览和导出任务。
   - 结果是：导出失败一次，整个视频就被显示为"失败"。项目列表的状态显示必须依赖准确的数据，所以这个 bug 要在本任务中一并修复。

## 2. 目标与非目标

**目标**
- 首页显示全部项目（视频），每个项目带封面、进度状态和占用空间，点击即可回到上次离开时所在的步骤。
- 可以安全地删除项目：数据库记录和磁盘文件都要清理干净，正在运行的任务会被取消，删除过程中不会产生无法访问或不一致的中间状态。
- 任务抽屉中的任务可以直接打开对应的项目。

**非目标（本次不做）**
- 重命名、归档、批量删除、回收站和撤销删除。
- 分页加载。本地单用户场景下项目数量有限，`limit` 默认 200 即可。
- 修改上传流程。

---

## 3. 现状要点（实现前必读）

| 事实 | 位置 | 对实现的影响 |
| --- | --- | --- |
| 每个视频的所有文件都在 `settings.projects_dir / video_id` 下：`source.bin`（演示数据中是 `source.mp4`）、`proxy.mp4`、`thumbnails/*.jpg`、`preview-<rev>.mp4`、`render-<rev>.mp4`，以及临时文件 `.<kind>-<rev>.mkv` | `api/app.py` 中的 `upload_video`、`pipeline/analysis.py`、`pipeline/render.py` | 删除时只需删掉这一个目录。项目目录统一用 `Path(video.source_path).parent` 取得 |
| SQLite **没有**开启 `PRAGMA foreign_keys`，模型中写的 `ondelete="CASCADE"` 不会生效 | `storage/database.py` | **必须显式按依赖顺序删除各表记录**。不要在本任务中开启外键约束，影响范围太大 |
| `Detection` 只关联 `frame_id`，没有 `video_id` 字段 | `storage/models.py` | 需要先查出该视频的所有 frame id，再按 frame id 删除 detections |
| 上传时**先建目录**，探测完视频后才写入数据库 | `upload_video` | 任何"孤儿目录清理"都必须跳过最近修改过的目录，否则会误删正在上传的视频 |
| worker 每次只处理一个任务。取消任务时，进度回调会抛出 `InterruptedError`，任务随后被置为 `cancelled` | `worker/main.py` | 运行中的任务不能被直接打断；文件必须等任务停下后才能删除 |
| `VideoState.DELETED` 已经定义，但没有任何地方使用 | `domain/enums.py` | 用作"已标记删除、等待清理"的状态 |
| `Video.updated_at` 只在视频记录本身被修改时更新 | `storage/models.py` | 需要另外计算"最近活动时间"，见 4.1 |

---

## 4. 后端设计

### 4.1 `GET /api/v1/videos`：项目列表

查询参数：`limit`（1–500，默认 200）。

响应 `VideoListResponse`：

```jsonc
{
  "items": [VideoSummaryResponse, ...],   // 按 last_activity_at 倒序
  "total": 3,
  "storage_bytes_total": 3456789012       // items 中 storage_bytes 的总和
}
```

`VideoSummaryResponse`：

| 字段 | 类型 | 计算方式 |
| --- | --- | --- |
| `id` `original_name` `width` `height` `duration_us` `size_bytes` `has_audio` `created_at` | 同 `VideoResponse` | 直接取自 Video 记录 |
| `state` | str | 直接取自 Video 记录（仅供参考，前端不要依赖它判断状态） |
| `last_activity_at` | datetime | 取以下三者的最大值：`video.updated_at`、该视频最新修订版本的 `created_at`、该视频最新任务的 `updated_at` |
| `storage_bytes` | int | 递归统计项目目录下所有文件的大小，用 `os.scandir` 实现，忽略 `OSError`。目录不存在时返回 0 |
| `cover_thumbnail_id` | str \| null | 在出镜时长（`screen_time_us`）最长的人物中，取 `quality_score` 最高的缩略图 |
| `person_count` | int | `GlobalPerson` 的数量 |
| `latest_analysis` | `{id, status, stage, progress, error_detail}` \| null | 该视频最新的 analysis 任务 |
| `active_job` | `{id, kind, status, stage, progress}` \| null | 该视频最新的 queued 或 running 任务 |
| `latest_revision` | `{id, ordinal, person_id, person_label, created_at}` \| null | `ordinal` 最大的修订版本 |
| `revision_count` | int | 该视频的修订版本总数（删除确认对话框中使用） |
| `latest_render` | `{artifact_id, revision_id, revision_ordinal, created_at}` \| null | 最新一个 `kind="render"` 且 `valid=True` 的 Artifact |

规则：
- 列表**不包含** `state == DELETED` 的视频。
- 不要求把所有字段压进一条 SQL。本地项目数量很少，每个视频单独做几次查询是可以接受的。把每个视频的汇总逻辑写成一个独立函数 `summarize_video(session, video) -> VideoSummaryResponse`，便于单元测试。
- 必须把 `@app.get("/api/v1/videos")` 注册在 `@app.get("/api/v1/videos/{video_id}")` **之前**，否则路由可能匹配错误。

### 4.2 `DELETE /api/v1/videos/{video_id}`：两阶段删除

为了不让前端的 `request()` 在解析空响应体时出错，删除接口**始终返回 JSON**：

```jsonc
// 200：已经彻底删除
{ "id": "...", "status": "deleted",  "cancelled_job_ids": ["..."] }
// 202：有任务正在运行，已标记删除，等 worker 停下该任务后再清理
{ "id": "...", "status": "deleting", "cancelled_job_ids": ["..."] }
// 404：视频不存在，或已处于 DELETED 状态
```

处理流程，在同一个事务中完成：

1. 加载视频。如果不存在，或 `state == DELETED`，返回 404。
2. 设置 `video.state = VideoState.DELETED`。
3. 遍历该视频所有 `queued` 或 `running` 状态的任务：
   - `queued`：直接置为 `status=cancelled`、`stage="cancelled"`、`cancel_requested=True`；
   - `running`：只设置 `cancel_requested=True`。
   - 把这些任务的 id 记入 `cancelled_job_ids`。
4. 提交事务（commit）。
5. 如果该视频没有 `running` 状态的任务，立即调用 `purge_video(session, video_id)`，返回 200 和 `"deleted"`；否则返回 202 和 `"deleting"`。

### 4.3 `purge_video`：清理实现

新建模块 `src/figure_detection/storage/purge.py`：

```python
def purge_video(session: Session, video_id: str) -> bool:
    """Delete every row and file of a DELETED video. Idempotent; returns False if nothing to do."""

def purge_deleted_videos(session: Session) -> list[str]:
    """Purge all DELETED videos that have no running job. Returns purged ids."""

def sweep_orphan_project_dirs(projects_dir: Path, known_ids: set[str], min_age_s: float = 3600) -> list[Path]:
    """Remove project directories with no DB row, but only if untouched for min_age_s."""
```

`purge_video` 的要求：
- 必须幂等。视频不存在时返回 `False`；视频状态不是 `DELETED` 时，**拒绝清理并返回 `False`**，以防误删。
- 如果该视频还有 `running` 状态的任务，返回 `False`。
- 在执行删除之前，先计算出项目目录 `project_dir = Path(video.source_path).parent.resolve()`。
- 按以下顺序删除数据库记录（使用 `delete(...)` 语句，不要逐条加载对象）：
  1. `Detection`：`frame_id IN (该视频所有 Frame 的 id)`。用子查询实现，不要把 id 一次性全部加载到内存里，数量可能达到几十万条。
  2. `MaskPrompt` 和 `IdentityOverride`：`revision_id IN (该视频所有 SelectionRevision 的 id)`。
  3. `Artifact`：`video_id ==`。
  4. `SelectionRevision`：`video_id ==`。整批删除即可，父子关系不需要先断开。
  5. `Thumbnail` 和 `PersonMembership`：`person_id IN (该视频所有 GlobalPerson 的 id)`。
  6. `GlobalPerson`、`Frame`、`Tracklet`、`Shot`、`Job`：`video_id ==`。
  7. `Video`。
- 提交事务后再删除文件：
  - 先做路径安全检查：`project_dir` 必须是 `get_settings().projects_dir.resolve()` 的**直接子目录**，且目录名等于 `video_id`。不满足任一条件时，只记录 warning 日志，不删除任何文件。
  - 用 `shutil.rmtree(project_dir)` 删除。删除失败时记录 exception 日志，但仍返回 `True`，因为数据库记录已经删除；残留的目录交给孤儿清理处理。

`sweep_orphan_project_dirs` 的要求：
- 只处理目录名是合法 UUID、且不在 `known_ids` 中的目录。
- 目录及其所有内容的最近修改时间都必须早于 `min_age_s`，这样可以避开正在上传的视频。
- 不处理 `projects_dir` 以外的任何路径。

### 4.4 worker 改动（`worker/main.py`）

1. **只有分析任务失败时才把视频标为失败。** 在 `except Exception` 分支中，只有当 `job.kind == JobKind.ANALYSIS` 时，才设置 `video.state = FAILED` 和 `video.error_*`。预览或导出失败只影响任务本身。
2. **跳过已删除的视频。** 在 `process_job` 加载视频之后，如果 `video.state == VideoState.DELETED`，将任务置为 `cancelled`、`stage="cancelled"`，然后返回。
3. **在租用新任务前清理。** 在 `lease_next_job` 的查询中，用 join 排除 `Video.state == DELETED` 的任务；这类任务按第 2 条直接置为取消，也可以忽略。
4. **定期清理。**
   - worker 启动时（`create_schema()` 之后），以及主循环中每处理完一个任务、或每次空闲轮询时，调用一次 `purge_deleted_videos(session)`。
   - 启动时额外调用一次 `sweep_orphan_project_dirs`。
   - 所有清理调用都要包在 `try/except` 中并记录日志，**清理失败不能导致 worker 退出**。

### 4.5 让其他接口对已删除视频返回 404

新增一个辅助函数 `_live_video(session, video_id) -> Video`：视频不存在，或 `state == DELETED` 时，抛出 404。用它替换以下接口中对 `session.get(Video, ...)` 的直接调用：

`get_video`、`get_proxy`、`create_analysis_job`、`list_people`、`get_timeline`、`create_selection`、`list_selection_revisions`

对于通过修订版本、缩略图或产物 id 访问的接口，需要先找到所属视频，再做同样的检查：

| 接口 | 如何找到所属视频 |
| --- | --- |
| `get_selection_revision`、`update_revision_settings`、`add_identity_override`、`add_mask_prompt`、`create_revision_job` | `revision.video_id` |
| `download_artifact` | `artifact.video_id` |
| `get_thumbnail` | 通过 thumbnail 找到 person，再取 `person.video_id` |

`list_jobs` 要过滤掉已删除视频的任务。在 join `Video` 时加上条件 `Video.state != DELETED`。

### 4.6 Schemas（`api/schemas.py`）

新增以下模型：
- `JobBrief`：`{id, kind, status, stage, progress}`
- `AnalysisBrief`：在 `JobBrief` 的基础上增加 `error_detail`
- `RevisionBrief`
- `RenderBrief`
- `VideoSummaryResponse`
- `VideoListResponse`
- `VideoDeleteResponse`

字段定义见 4.1 和 4.2。

---

## 5. 前端设计

### 5.1 信息架构

- 第 1 步重命名为 **"视频 / Video"**（`step.upload`），作为首页，内容自上而下为：
  1. 上传区。已有项目时，上传区缩小为高约 120px 的横条。
  2. "项目"列表。
- 点击顶栏的 MIRAI 品牌区域，回到首页。
- 删除现有的 `resume-card`，它的作用由项目列表取代。

### 5.2 项目卡片 `ProjectCard`

使用网格布局 `repeat(auto-fill, minmax(260px, 1fr))`。每张卡片包含：

- **封面**：16:9 比例。有 `cover_thumbnail_id` 时显示缩略图（`object-fit: cover`，`object-position: top`），否则显示 `FilmIcon` 占位图。
- **状态标签**：浮在封面左上角，由 `projectStatus(summary)` 计算，规则见 5.3。
- **标题**：`original_name`，只显示一行，超出部分用省略号。
- **元信息**：`时长 · 分辨率 · storage_bytes` 和"最近活动于 {相对时间}"。相对时间用 `Intl.RelativeTimeFormat` 生成，跟随当前界面语言。
- **主操作**：整张卡片可点击，点击后调用 `openVideo(id)`。
- **"⋯"菜单**：
  - "打开"；
  - "下载最新导出"：只在 `latest_render` 存在时显示；
  - 分隔线；
  - "删除项目"：使用危险色。
  - 菜单需要支持键盘操作：`Enter` / `Space` 打开，方向键移动，`Esc` 关闭。

### 5.3 状态推导

在 `web/src/projects.ts` 中实现纯函数 `projectStatus`，并编写单元测试。规则按以下顺序判断，第一个满足的生效：

| 条件 | 状态 | 标签（zh / en） | 颜色 |
| --- | --- | --- | --- |
| `active_job.kind == "analysis"` | `analyzing` | 分析中 {percent} / Analyzing {percent} | brand |
| `latest_analysis == null` | `new` | 待分析 / Not analyzed | 中性 |
| `latest_analysis.status == "failed"` | `analysis_failed` | 分析失败 / Analysis failed | danger |
| `latest_analysis.status == "cancelled"` | `analysis_cancelled` | 分析已取消 / Analysis cancelled | 中性 |
| `person_count == 0` | `no_people` | 未检测到人物 / No people found | 中性 |
| `active_job` 是 preview 或 render | `exporting` | 导出中 {percent} / Exporting {percent} | brand |
| `latest_revision == null` | `choose_person` | 待选择人物 / Choose a person | warn |
| `latest_render` 存在且 `latest_render.revision_id == latest_revision.id` | `exported` | 已导出 / Exported | clear |
| 其他情况 | `editing` | 编辑中 · {person_label} r{ordinal} / Editing · … | 中性 |

### 5.4 打开项目：`openVideo(videoId)`

在 `App.tsx` 中，把现有的 reload-resume 逻辑抽取为一个公共函数，页面刷新时恢复和点击项目卡片都调用它：

1. 调用 `resetWorkflow()`，并把 `handledAnalysis` 引用置空。
2. 调用 `getVideo` 加载视频，再调用 `loadSelectionData` 加载人物和修订版本列表。
3. 写入 `localStorage`：
   - `mirai.videoId` 设为当前视频 id；
   - 新增 `mirai.revisionByVideo`，内容是 `{ [videoId]: revisionId }` 形式的 JSON 映射。
   - 原有的 `mirai.revisionId` 作废：读取时若存在，迁移一次到新映射后删除。
4. 按以下规则决定进入哪一步：
   - 存在进行中的分析任务，或人物数量为 0：进入 `analyze`；
   - `revisionByVideo[videoId]` 存在且能成功加载：进入 `edit`；
   - 否则，存在 `latest_revision`：用它进入 `edit`；
   - 否则：进入 `select`。
5. 加载失败时（例如视频已被删除，返回 404）：从 `localStorage` 中清除该视频的记录，提示"项目不存在或已被删除"，刷新项目列表，停留在首页。

`adoptRevision` 改为同时写入 `revisionByVideo`。

### 5.5 删除流程

新增通用的 `components/ConfirmDialog.tsx`，要求：
- 使用原生 `<dialog>` 元素，打开时调用 `showModal()`；
- 焦点限制在对话框内，`Esc` 和点击遮罩都视为取消；
- 打开时默认聚焦在"取消"按钮上，而不是危险按钮。

删除确认对话框的内容：
- **标题**：删除"{name}"？
- **正文**：将永久删除源视频、分析结果、{n} 个版本和所有导出文件，共释放 {size}。此操作无法撤销。
- **如果有进行中的任务**：用 warn 样式的提示框说明"正在进行的{kind}任务会被取消"。
- **按钮**：取消，以及使用危险色的"删除"。

点击"删除"后：
1. 卡片立即进入"正在删除…"状态：变暗，不可点击。
2. 调用 `deleteVideo(id)`：
   - 返回 `"deleted"`：从列表中移除该卡片，提示"已删除 {name}"。
   - 返回 `"deleting"`：卡片保持"正在删除…"状态；首页每 2 秒刷新一次列表，直到该项目不再出现。
   - 请求失败：恢复卡片原状，并提示错误信息。
3. 如果删除的是当前打开的视频：调用 `resetWorkflow()`，清除该视频在 `localStorage` 中的所有记录，并留在首页。

在编辑器的顶部栏（`stage-bar`）或"更换人物"按钮旁，**不要**放删除入口。删除只能从首页发起，以免误操作。

### 5.6 首页列表的其他功能

- 列表标题行：`项目 · {total}`，右侧显示总占用 `共 {storage}`。
- **搜索框**：在前端按名称过滤，忽略大小写。
- **排序下拉**：最近活动（默认）、名称、占用空间。
- **数据刷新**：首页可见时，每 5 秒刷新一次列表；有进行中的任务时，改为每 2 秒刷新一次。离开首页后停止刷新。
- **空状态**：没有任何项目时，只显示上传区，不显示空的列表框。
- **加载状态**：首次加载时显示 3 张骨架卡片。

### 5.7 任务抽屉

每条任务增加"打开"按钮，点击后先调用 `openVideo(job.video_id)`，再关闭抽屉。如果该任务所属的视频就是当前打开的视频，则不显示这个按钮。

### 5.8 文件改动清单

| 文件 | 改动 |
| --- | --- |
| `web/src/types.ts` | 新增 `VideoSummary`、`VideoList`、`VideoDeleteResult`、`JobBrief` 等类型 |
| `web/src/api.ts` | 新增 `listVideos()`、`deleteVideo(id)` |
| `web/src/projects.ts`（新建） | `projectStatus()` 和排序、过滤函数 |
| `web/src/projects.test.ts`（新建） | 覆盖 5.3 表格中的每一条状态规则，以及排序和过滤 |
| `web/src/components/ProjectCard.tsx`（新建） | 项目卡片和"⋯"菜单 |
| `web/src/components/ConfirmDialog.tsx`（新建） | 通用确认对话框 |
| `web/src/views/HomeView.tsx`（新建） | 由 `UploadView` 演进而来：上传区和项目列表。`UploadView` 中的上传逻辑抽取为 `components/UploadDropzone.tsx`，原 `UploadView.tsx` 删除 |
| `web/src/App.tsx` | 实现 `openVideo`；`localStorage` 改用 `revisionByVideo`；点击品牌区域回到首页；处理删除当前视频的情况；向任务抽屉传入 `onOpenVideo` |
| `web/src/components/QueueDrawer.tsx` | 增加"打开"按钮 |
| `web/src/i18n.tsx` | 新增中英文文案键，见 5.9 |
| `web/src/styles.css` | 项目网格、卡片、菜单、对话框、骨架屏、上传区横条样式 |

### 5.9 新增文案键（中英文都必须提供）

```
step.upload            -> 视频 / Video
home.projects          -> 项目 / Projects
home.storageTotal      -> 共 {size} / {size} total
home.search            -> 搜索项目 / Search projects
home.sort.activity     -> 最近活动 / Recent activity
home.sort.name         -> 名称 / Name
home.sort.size         -> 占用空间 / Size
home.noMatch           -> 没有匹配的项目 / No matching projects
project.lastActivity   -> 最近活动于 {time} / Active {time}
project.open           -> 打开 / Open
project.downloadLatest -> 下载最新导出 / Download latest export
project.delete         -> 删除项目 / Delete project
project.deleting       -> 正在删除… / Deleting…
project.deleted        -> 已删除 {name} / Deleted {name}
project.deleteFailed   -> 删除失败：{error} / Could not delete: {error}
project.missing        -> 项目不存在或已被删除 / Project no longer exists
project.status.*       -> 见 5.3 表格
delete.title           -> 删除“{name}”？ / Delete “{name}”?
delete.body            -> 将永久删除源视频、分析结果、{revisions} 个版本和所有导出文件，共释放 {size}。此操作无法撤销。
                          / This permanently deletes the source video, analysis, {revisions} revisions and all exports, freeing {size}. This cannot be undone.
delete.activeJobs      -> 正在进行的{kinds}任务会被取消。 / Running {kinds} jobs will be cancelled.
delete.confirm         -> 删除 / Delete
delete.cancel          -> 取消 / Cancel
queue.open             -> 打开 / Open
```

注意：`delete.body` 中的 `{revisions}` 取自 `revision_count`，即该视频的修订版本总数，而不是最新版本的序号。

---

## 6. 测试

### 6.1 后端

新增 `tests/integration/test_projects.py`。沿用 `tests/integration/test_revisions.py` 的写法：建一个临时 SQLite 数据库，直接调用路由函数。由于 `purge_video` 需要用到 `get_settings().projects_dir`，测试中用 monkeypatch 设置 `FIGURE_DETECTION_RUNTIME_DIR` 指向 `tmp_path`，并调用 `get_settings.cache_clear()`。

需要覆盖的用例：

1. **列表**：
   - 按 `last_activity_at` 倒序排列；
   - 不包含 DELETED 状态的视频；
   - `storage_bytes` 与项目目录实际大小一致；
   - `cover_thumbnail_id` 来自出镜时长最长的人物；
   - `latest_render` 只统计 `valid=True` 的产物。
2. **没有任务时删除**：返回 `"deleted"`。之后4.3 中列出的 13 张表中都不存在与该视频相关的记录，项目目录被删除。
3. **有排队任务时删除**：该任务变为 `cancelled`，并出现在 `cancelled_job_ids` 中；随后立即完成清理。
4. **有运行中任务时删除**：
   - 返回 `"deleting"`，视频状态变为 DELETED，任务被标记 `cancel_requested=True`，文件仍然存在；
   - 把任务改为 `cancelled` 后，调用 `purge_deleted_videos`，视频被清理。
5. **删除后的接口行为**：`get_video`、`get_proxy`、`list_people`、`get_timeline`、`create_selection`、`get_selection_revision`、`download_artifact`、`get_thumbnail` 都返回 404；`list_jobs` 中不再出现该视频的任务。
6. **重复删除**：第二次删除同一个视频返回 404。
7. **路径安全**：如果 `source_path` 指向 `projects_dir` 以外的位置，数据库记录被删除，但该位置的文件保持不动。
8. **孤儿目录清理**：
   - 刚创建的目录不会被删除；
   - 修改时间被改到很早之前的孤儿目录会被删除；
   - 目录名不是 UUID 的不会被删除；
   - 数据库中存在对应记录的目录不会被删除。
9. **worker**：
   - 预览或导出失败后，视频状态**保持不变**，不会变成 FAILED；
   - 分析失败后，视频状态变为 FAILED；
   - 属于 DELETED 视频的任务被取消，不会执行。

   测试时可以 monkeypatch `render_video`，让它直接抛出异常。

### 6.2 前端

- `projects.test.ts`：覆盖 5.3 表格中的每一行，以及排序和名称过滤（忽略大小写）。
- 手动或 Playwright 冒烟测试：使用演示数据（见路线图第 18 项），覆盖以下流程：
  1. 首页显示演示项目；
  2. 打开后进入正确的步骤；
  3. 返回首页，删除项目；
  4. 列表变为空；
  5. 磁盘上的 `/tmp/mirai-demo/projects/<id>` 目录已被删除。

---

## 7. 验收标准

- [ ] 首页列出所有未删除的项目。状态、封面、占用空间与实际情况一致；切换语言后，所有文案（包括相对时间）都随之切换。
- [ ] 点击任意项目，都会进入该项目上次所在的步骤；如果是编辑步骤，会恢复上次使用的修订版本。刷新页面后结果一致。
- [ ] 删除空闲项目后，项目在 1 秒内从列表中消失；数据库中没有残留记录，磁盘上没有残留目录。
- [ ] 删除有运行中任务的项目：卡片显示"正在删除…"，任务被取消，worker 停下该任务后项目被清理，worker 本身不退出、不报错。
- [ ] 删除当前打开的项目后，界面回到首页，刷新页面也不会尝试恢复已删除的项目。
- [ ] 某个视频的导出失败后，它在项目列表中的状态不会变成"分析失败"。
- [ ] `uv run pytest`、`uv run ruff check .`、`uv run ruff format --check .`、`npm run build`、`npm test` 全部通过。
- [ ] 在同一提交中更新 `AGENTS.md`：
  - "Data and API invariants"：说明删除采用两阶段流程、清理时显式按顺序删除各表（不依赖外键级联）、DELETED 状态的视频对所有接口不可见；
  - "Architecture decisions"：增加一条带日期的决策记录；
  - "Current status"：更新当前进度。
- [ ] 在 `README.md` 的 "Runtime data" 一节说明：可以在界面中删除项目；不要直接手动删除 `var/projects` 下的目录。

## 8. 建议的提交拆分

1. `fix(worker): only analysis failures mark a video failed`：4.4 第 1 条及对应测试。
2. `feat(api): list projects and delete videos with two-phase purge`：4.1–4.6、6.1 中的测试，以及 `AGENTS.md` 和 README 的更新。
3. `feat(web): project home with open and delete`：第 5 节全部内容和 6.2 中的单元测试。
