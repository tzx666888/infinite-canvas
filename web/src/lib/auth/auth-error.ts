export class AuthError extends Error {
    status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = "AuthError";
        this.status = status;
    }
}

export function authErrorResponse(error: unknown) {
    if (error instanceof AuthError) return Response.json({ message: error.message }, { status: error.status });
    console.error("Auth API failed", error);
    return Response.json({ message: "账户服务暂时不可用，请稍后重试" }, { status: 500 });
}
