import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "../types";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    const flowStroke = "#8b5cf6";
    const flowCore = "#f5f3ff";

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path d={pathD} stroke={theme.node.muted} strokeWidth="2" strokeOpacity={active ? 0.95 : 0.82} strokeLinecap="round" fill="none" style={{ pointerEvents: "none" }} />
            {active ? (
                <>
                    <path d={pathD} pathLength="100" stroke={flowStroke} strokeWidth="5.5" strokeOpacity="0.9" strokeLinecap="round" strokeDasharray="5 20" fill="none" style={{ filter: `drop-shadow(0 0 7px ${flowStroke})`, pointerEvents: "none" }}>
                        <animate attributeName="stroke-dashoffset" from="0" to="-25" dur="1.05s" repeatCount="indefinite" />
                    </path>
                    <path d={pathD} pathLength="100" stroke={flowCore} strokeWidth="2.2" strokeOpacity="1" strokeLinecap="round" strokeDasharray="5 20" fill="none" style={{ filter: `drop-shadow(0 0 3px ${flowCore})`, pointerEvents: "none" }}>
                        <animate attributeName="stroke-dashoffset" from="0" to="-25" dur="1.05s" repeatCount="indefinite" />
                    </path>
                </>
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;
    const flowStroke = "#8b5cf6";
    const flowCore = "#f5f3ff";

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return (
        <g style={{ pointerEvents: "none" }}>
            <path d={pathD} stroke={theme.node.muted} strokeWidth="2" strokeOpacity="0.9" strokeLinecap="round" fill="none" />
            <path d={pathD} pathLength="100" stroke={flowStroke} strokeWidth="5.5" strokeOpacity="0.9" strokeLinecap="round" strokeDasharray="5 20" fill="none" style={{ filter: `drop-shadow(0 0 7px ${flowStroke})` }}>
                <animate attributeName="stroke-dashoffset" from="0" to="-25" dur="0.9s" repeatCount="indefinite" />
            </path>
            <path d={pathD} pathLength="100" stroke={flowCore} strokeWidth="2.2" strokeOpacity="1" strokeLinecap="round" strokeDasharray="5 20" fill="none" style={{ filter: `drop-shadow(0 0 3px ${flowCore})` }}>
                <animate attributeName="stroke-dashoffset" from="0" to="-25" dur="0.9s" repeatCount="indefinite" />
            </path>
        </g>
    );
}
