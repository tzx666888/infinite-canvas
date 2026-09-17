import { AuthError } from "../auth/auth-error.ts";
import { canvasDatabase } from "../auth/database.ts";

export function videoTaskIdFromPath(path: string) {
    return /^v1\/videos\/(?:generations\/)?([^/]+)(?:\/content)?$/.exec(path)?.[1]
        || /^v1\/contents\/generations\/tasks\/([^/]+)$/.exec(path)?.[1] || "";
}

export function requireVideoTaskOwner(path: string, userId: string) {
    if (!path.startsWith("v1/videos") && !path.startsWith("v1/contents/generations/tasks")) return;
    if (["v1/videos", "v1/videos/generations", "v1/contents/generations/tasks"].includes(path)) {
        throw new AuthError("不支持列出共享上游任务", 404, "task_not_found");
    }
    const taskId = videoTaskIdFromPath(path);
    const db = canvasDatabase();
    // Existing billed tasks remain recoverable after deployment. No unowned fallback.
    const owner = db.prepare("SELECT user_id FROM video_task_owners WHERE task_id = ?").get(taskId)
        || db.prepare("SELECT user_id FROM billing_transactions WHERE upstream_task_id = ?").get(taskId);
    if (!owner || owner.user_id !== userId) throw new AuthError("视频任务不存在或无权访问", 404, "task_not_found");
}

export async function rememberVideoTaskOwner(response: Response, path: string, userId: string, requestId: string) {
    if (!response.ok || !["v1/videos", "v1/videos/generations", "v1/contents/generations/tasks"].includes(path)) return response;
    const payload = await response.clone().json().catch(() => null);
    const task = payload?.data || payload;
    const taskId = task?.id || task?.request_id || task?.task_id;
    if (typeof taskId === "string" && taskId.trim()) {
        const db = canvasDatabase();
        db.prepare("INSERT OR IGNORE INTO video_task_owners (task_id, user_id, request_id, created_at) VALUES (?, ?, ?, ?)")
            .run(taskId.trim(), userId, requestId, new Date().toISOString());
        if (db.prepare("SELECT user_id FROM video_task_owners WHERE task_id = ?").get(taskId.trim())?.user_id !== userId) {
            throw new AuthError("上游任务编号冲突，请联系管理员", 502, "upstream_task_conflict");
        }
    }
    return response;
}
