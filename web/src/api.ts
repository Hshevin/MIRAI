import type {
  Detection,
  Health,
  IdentityOverrideInput,
  Job,
  MaskPromptInput,
  Person,
  QueueJob,
  RenderSettings,
  Revision,
  RevisionEditResponse,
  Video,
} from "./types";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8000/api/v1";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** FastAPI error bodies carry `detail` as a string or a validation-error array. */
function detailFrom(body: unknown): string | null {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (detail != null) {
      return JSON.stringify(detail);
    }
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "Network error", 0);
  }
  if (!response.ok) {
    let message = `HTTP ${response.status} ${response.statusText}`;
    try {
      const detail = detailFrom(await response.json());
      if (detail) {
        message = detail;
      }
    } catch {
      // Body was not JSON; keep the HTTP status message.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(
    path,
    body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

export function getHealth(): Promise<Health> {
  return request<Health>("/health");
}

/** Uploads via XMLHttpRequest because fetch cannot report upload progress. */
export function uploadVideo(
  file: File,
  onProgress: (loaded: number, total: number) => void,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/videos`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        reject(new ApiError("Invalid server response", xhr.status));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body as Video);
        return;
      }
      reject(new ApiError(detailFrom(body) ?? `Upload failed (HTTP ${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.ontimeout = () => reject(new ApiError("Upload timed out", 0));
    const form = new FormData();
    form.append("upload", file, file.name);
    xhr.send(form);
  });
}

export function getVideo(videoId: string): Promise<Video> {
  return request<Video>(`/videos/${videoId}`);
}

export function getPeople(videoId: string): Promise<Person[]> {
  return request<Person[]>(`/videos/${videoId}/people`);
}

export function getTimeline(videoId: string): Promise<Detection[]> {
  return request<Detection[]>(`/videos/${videoId}/timeline`);
}

export function createAnalysisJob(videoId: string): Promise<Job> {
  return post<Job>(`/videos/${videoId}/analysis-jobs`);
}

export function getJob(jobId: string): Promise<Job> {
  return request<Job>(`/jobs/${jobId}`);
}

export function listJobs(): Promise<QueueJob[]> {
  return request<QueueJob[]>("/jobs");
}

export function cancelJob(jobId: string): Promise<Job> {
  return post<Job>(`/jobs/${jobId}/cancel`);
}

export function createSelection(
  videoId: string,
  personId: string,
  settings: RenderSettings,
): Promise<Revision> {
  return post<Revision>(`/videos/${videoId}/selection-revisions`, {
    person_id: personId,
    settings,
  });
}

export function addMaskPrompt(
  revisionId: string,
  prompt: MaskPromptInput,
): Promise<RevisionEditResponse> {
  return post<RevisionEditResponse>(`/selection-revisions/${revisionId}/mask-prompts`, prompt);
}

export function addIdentityOverride(
  revisionId: string,
  override: IdentityOverrideInput,
): Promise<RevisionEditResponse> {
  return post<RevisionEditResponse>(
    `/selection-revisions/${revisionId}/identity-overrides`,
    override,
  );
}

export function createRevisionJob(revisionId: string, kind: "preview" | "render"): Promise<Job> {
  return post<Job>(`/selection-revisions/${revisionId}/${kind}-jobs`);
}

export function proxyUrl(videoId: string): string {
  return `${API_BASE}/videos/${videoId}/proxy`;
}

export function thumbnailUrl(thumbnailId: string): string {
  return `${API_BASE}/thumbnails/${thumbnailId}`;
}

export function artifactUrl(artifactId: string): string {
  return `${API_BASE}/artifacts/${artifactId}/download`;
}

export function parseArtifactId(job: Job): string | null {
  if (!job.result_json) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(job.result_json);
    if (parsed && typeof parsed === "object" && "artifact_id" in parsed) {
      const artifactId = (parsed as { artifact_id: unknown }).artifact_id;
      return typeof artifactId === "string" ? artifactId : null;
    }
  } catch {
    // Malformed result payload.
  }
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
