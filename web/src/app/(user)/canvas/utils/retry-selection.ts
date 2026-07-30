type DirectedConnection = {
    fromNodeId: string;
    toNodeId: string;
};

export function selectLeafFailureIds(failedNodeIds: string[], connections: DirectedConnection[]) {
    const failedIds = new Set(failedNodeIds);
    return failedNodeIds.filter((nodeId) => !connections.some((connection) => connection.fromNodeId === nodeId && failedIds.has(connection.toNodeId)));
}
