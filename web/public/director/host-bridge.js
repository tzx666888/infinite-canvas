(() => {
    const parentWindow = window.parent;
    if (!parentWindow || parentWindow === window) return;

    let acknowledged = false;
    let attempts = 0;
    let timer = 0;

    const announceWhenMounted = () => {
        if (acknowledged || !document.querySelector(".app-shell")) return;
        parentWindow.postMessage({ type: "storyai:director-ready" }, "*");
    };

    const startHandshake = () => {
        announceWhenMounted();
        if (timer) return;
        timer = window.setInterval(() => {
            attempts += 1;
            announceWhenMounted();
            if (acknowledged || attempts >= 120) {
                window.clearInterval(timer);
                timer = 0;
            }
        }, 250);
    };

    window.addEventListener("message", (event) => {
        if (event.source !== parentWindow) return;
        if (event.data?.type === "storyai:director-session") {
            acknowledged = true;
            if (timer) window.clearInterval(timer);
            timer = 0;
            return;
        }
        if (event.data?.type === "storyai:director-probe") announceWhenMounted();
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startHandshake, { once: true });
    } else {
        startHandshake();
    }
})();
