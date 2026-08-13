export class AuthError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status = 400, code?: string) {
        super(message);
        this.name = "AuthError";
        this.status = status;
        this.code = code;
    }
}

export function authErrorResponse(error: unknown) {
    if (error instanceof AuthError) {
        const code = error.code || "account_request_failed";
        return Response.json({ message: error.message, code, error: { message: error.message, code } }, { status: error.status });
    }
    console.error("Auth API failed", error);
    const message = "账户服务暂时不可用，请稍后重试";
    return Response.json({ message, code: "account_service_unavailable", error: { message, code: "account_service_unavailable" } }, { status: 500 });
}
