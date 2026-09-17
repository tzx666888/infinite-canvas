export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { ensureGatewayTaskReconciler } = await import("./lib/gateway/billing");
        ensureGatewayTaskReconciler();
    }
}
