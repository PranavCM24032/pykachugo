import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  GitBranch,
  Pencil,
  QrCode,
  RotateCcw,
} from 'lucide-react';
import type { Puzzle } from '../types/game';

interface PuzzleConnectionMapProps {
  puzzles: Puzzle[];
  onEditPuzzle: (puzzle: Puzzle) => void;
  onShowQr?: (puzzle: Puzzle) => void;
}

interface PositionedNode {
  puzzle: Puzzle;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  angle: number;
  inDegree: number;
  outDegree: number;
}

interface GraphEdge {
  key: string;
  fromId: number;
  toId: number;
  path: string;
  isBidirectional: boolean;
  isSelfLoop: boolean;
}

const SVG_W = 840;
const SVG_H = 620;
const CX = SVG_W / 2;
const CY = SVG_H / 2;

export const PuzzleConnectionMap: React.FC<PuzzleConnectionMapProps> = ({
  puzzles,
  onEditPuzzle,
  onShowQr,
}) => {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const sortedPuzzles = useMemo(
    () => [...puzzles].sort((a, b) => a.id - b.id),
    [puzzles]
  );

  const puzzleById = useMemo(() => {
    const map = new Map<number, Puzzle>();
    sortedPuzzles.forEach((p) => map.set(p.id, p));
    return map;
  }, [sortedPuzzles]);

  // Build adjacency and missing-target diagnostics
  const { incomingMap, outgoingMap, missingLinks, totalValidLinks } = useMemo(() => {
    const inc = new Map<number, number[]>();
    const out = new Map<number, number[]>();
    const missing: { fromId: number; toId: number }[] = [];
    let validCount = 0;

    sortedPuzzles.forEach((p) => {
      inc.set(p.id, []);
      out.set(p.id, []);
    });

    sortedPuzzles.forEach((p) => {
      const targets = Array.from(new Set(p.nextPuzzleId || []));
      targets.forEach((targetId) => {
        if (puzzleById.has(targetId)) {
          out.get(p.id)?.push(targetId);
          inc.get(targetId)?.push(p.id);
          validCount += 1;
        } else {
          missing.push({ fromId: p.id, toId: targetId });
        }
      });
    });

    return {
      incomingMap: inc,
      outgoingMap: out,
      missingLinks: missing,
      totalValidLinks: validCount,
    };
  }, [sortedPuzzles, puzzleById]);

  const count = sortedPuzzles.length;
  const nodeR = count <= 10 ? 27 : count <= 18 ? 23 : count <= 28 ? 19 : 15;
  const ringR = count <= 1 ? 0 : count <= 12 ? 208 : 225;

  const nodes = useMemo<PositionedNode[]>(() => {
    if (count === 0) return [];
    return sortedPuzzles.map((puzzle, idx) => {
      const angle = count === 1 ? -Math.PI / 2 : -Math.PI / 2 + (2 * Math.PI * idx) / count;
      const x = count === 1 ? CX : CX + ringR * Math.cos(angle);
      const y = count === 1 ? CY : CY + ringR * Math.sin(angle);
      const labelOffset = nodeR + 18;
      const labelX = count === 1 ? CX : CX + (ringR + labelOffset) * Math.cos(angle);
      const labelY = count === 1 ? CY - nodeR - 14 : CY + (ringR + labelOffset) * Math.sin(angle);
      return {
        puzzle,
        x,
        y,
        labelX,
        labelY,
        angle,
        inDegree: incomingMap.get(puzzle.id)?.length || 0,
        outDegree: outgoingMap.get(puzzle.id)?.length || 0,
      };
    });
  }, [sortedPuzzles, count, ringR, nodeR, incomingMap, outgoingMap]);

  const nodeById = useMemo(() => {
    const map = new Map<number, PositionedNode>();
    nodes.forEach((n) => map.set(n.puzzle.id, n));
    return map;
  }, [nodes]);

  const edges = useMemo<GraphEdge[]>(() => {
    const list: GraphEdge[] = [];

    nodes.forEach((src) => {
      const targets = outgoingMap.get(src.puzzle.id) || [];
      targets.forEach((targetId) => {
        const dst = nodeById.get(targetId);
        if (!dst) return;

        // Self-loop edge (outward loop pointing back to node perimeter)
        if (src.puzzle.id === dst.puzzle.id) {
          const ux = Math.cos(src.angle);
          const uy = Math.sin(src.angle);
          const px = -uy;
          const py = ux;

          const sx = src.x + (nodeR + 2) * (ux * 0.85 + px * 0.52);
          const sy = src.y + (nodeR + 2) * (uy * 0.85 + py * 0.52);
          const ex = src.x + (nodeR + 5) * (ux * 0.85 - px * 0.52);
          const ey = src.y + (nodeR + 5) * (uy * 0.85 - py * 0.52);
          const c1x = src.x + (nodeR + 46) * (ux + px * 0.7);
          const c1y = src.y + (nodeR + 46) * (uy + py * 0.7);
          const c2x = src.x + (nodeR + 46) * (ux - px * 0.7);
          const c2y = src.y + (nodeR + 46) * (uy - py * 0.7);

          list.push({
            key: `${src.puzzle.id}->${dst.puzzle.id}`,
            fromId: src.puzzle.id,
            toId: dst.puzzle.id,
            path: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
            isBidirectional: false,
            isSelfLoop: true,
          });
          return;
        }

        const reverseExists = (outgoingMap.get(dst.puzzle.id) || []).includes(src.puzzle.id);
        const dx = dst.x - src.x;
        const dy = dst.y - src.y;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = -dy / dist;
        const ny = dx / dist;

        const mx = (src.x + dst.x) / 2;
        const my = (src.y + dst.y) / 2;

        // Curve control point:
        // - Bidirectional pairs separate to opposite sides via directed right-hand normal
        // - Single edges curve slightly toward circle center (or offset gently on diameters) so arrowheads stay crisp
        let ctrlX = mx;
        let ctrlY = my;

        if (reverseExists) {
          const bend = Math.min(54, Math.max(28, dist * 0.16));
          ctrlX = mx + nx * bend;
          ctrlY = my + ny * bend;
        } else {
          const toCenterX = CX - mx;
          const toCenterY = CY - my;
          const centerDist = Math.hypot(toCenterX, toCenterY);
          if (centerDist > 18) {
            // Pull slightly inward so chords stay clear of neighbor perimeters
            const pull = Math.min(34, dist * 0.1);
            ctrlX = mx + (toCenterX / centerDist) * pull;
            ctrlY = my + (toCenterY / centerDist) * pull;
          } else {
            // Near-diameter chord: slight perpendicular bow so crossing diameters don't stack
            const bend = Math.min(32, dist * 0.08);
            ctrlX = mx + nx * bend;
            ctrlY = my + ny * bend;
          }
        }

        // Trim curve start and end precisely at node circumferences along tangent vectors
        const startVecX = ctrlX - src.x;
        const startVecY = ctrlY - src.y;
        const startLen = Math.hypot(startVecX, startVecY) || 1;
        const sx = src.x + (startVecX / startLen) * (nodeR + 3);
        const sy = src.y + (startVecY / startLen) * (nodeR + 3);

        const endVecX = dst.x - ctrlX;
        const endVecY = dst.y - ctrlY;
        const endLen = Math.hypot(endVecX, endVecY) || 1;
        const ex = dst.x - (endVecX / endLen) * (nodeR + 6);
        const ey = dst.y - (endVecY / endLen) * (nodeR + 6);

        list.push({
          key: `${src.puzzle.id}->${dst.puzzle.id}`,
          fromId: src.puzzle.id,
          toId: dst.puzzle.id,
          path: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
          isBidirectional: reverseExists,
          isSelfLoop: false,
        });
      });
    });

    return list;
  }, [nodes, outgoingMap, nodeById, nodeR]);

  const activeFocusId = hoveredId ?? selectedId;
  const activeNode =
    selectedId !== null
      ? nodeById.get(selectedId) || null
      : hoveredId !== null
        ? nodeById.get(hoveredId) || null
        : null;

  const startNodes = useMemo(
    () => nodes.filter((n) => n.inDegree === 0 || Boolean(n.puzzle.startCode)),
    [nodes]
  );
  const endNodes = useMemo(
    () => nodes.filter((n) => n.outDegree === 0),
    [nodes]
  );

  if (count === 0) {
    return (
      <div className="rounded-xl border border-slate-800/80 bg-[#0E1420] px-6 py-14 text-center space-y-2">
        <GitBranch className="w-8 h-8 text-slate-500 mx-auto" />
        <p className="text-sm font-medium text-white">No puzzles to map yet</p>
        <p className="text-xs text-slate-400">
          Add puzzles or import an Excel sheet to view circular puzzle connections.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
      {/* Left: Circular Connection Graph */}
      <div className="xl:col-span-8 rounded-xl border border-slate-800/80 bg-[#0E1420] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Circular Puzzle Flow Map
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click or hover any node to trace incoming and outgoing puzzle arrows.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-emerald-400 bg-emerald-500/20" />
              <span>Start</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-400 bg-slate-700/40" />
              <span>Linked</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-amber-400 bg-amber-500/20" />
              <span>End</span>
            </span>
            {selectedId !== null && (
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Show All</span>
              </button>
            )}
          </div>
        </div>

        <div className="relative flex-1 bg-[#090D16] flex items-center justify-center p-2 sm:p-4">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full h-auto max-h-[560px] select-none"
            role="img"
            aria-label="Circular map showing directional connections between puzzle IDs"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedId(null);
              }
            }}
          >
            <defs>
              <marker
                id="arrow-default"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto"
              >
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#64748b" />
              </marker>
              <marker
                id="arrow-outgoing"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 1 L 9.5 5 L 0 9 z" fill="#22d3ee" />
              </marker>
              <marker
                id="arrow-incoming"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 1 L 9.5 5 L 0 9 z" fill="#f59e0b" />
              </marker>
            </defs>

            {/* Subtle circular guide track */}
            {count > 1 && (
              <circle
                cx={CX}
                cy={CY}
                r={ringR}
                fill="none"
                stroke="#1e293b"
                strokeWidth="1"
                strokeDasharray="4 6"
              />
            )}

            {/* Directed edges with arrowheads pointing to destination puzzle */}
            <g>
              {edges.map((edge) => {
                const isOutgoing = activeFocusId !== null && edge.fromId === activeFocusId;
                const isIncoming = activeFocusId !== null && edge.toId === activeFocusId;
                const isDimmed = activeFocusId !== null && !isOutgoing && !isIncoming;

                const stroke = isOutgoing
                  ? '#22d3ee'
                  : isIncoming
                    ? '#f59e0b'
                    : '#475569';
                const markerEnd = isOutgoing
                  ? 'url(#arrow-outgoing)'
                  : isIncoming
                    ? 'url(#arrow-incoming)'
                    : 'url(#arrow-default)';

                return (
                  <path
                    key={edge.key}
                    d={edge.path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isOutgoing || isIncoming ? 2.5 : 1.75}
                    strokeOpacity={isDimmed ? 0.14 : isOutgoing || isIncoming ? 0.98 : 0.72}
                    markerEnd={markerEnd}
                    className="transition-opacity duration-150"
                  />
                );
              })}
            </g>

            {/* Circular Puzzle ID Nodes */}
            <g>
              {nodes.map((node) => {
                const id = node.puzzle.id;
                const isSelected = selectedId === id;
                const isHovered = hoveredId === id;
                const isFocused = isSelected || isHovered;
                const isOutgoingTarget =
                  activeFocusId !== null &&
                  (outgoingMap.get(activeFocusId) || []).includes(id);
                const isIncomingSource =
                  activeFocusId !== null &&
                  (incomingMap.get(activeFocusId) || []).includes(id);
                const isNeighbor = isOutgoingTarget || isIncomingSource;
                const isDimmed = activeFocusId !== null && activeFocusId !== id && !isNeighbor;

                const isStart = node.inDegree === 0 || Boolean(node.puzzle.startCode);
                const isEnd = node.outDegree === 0;

                let fill = '#0f172a';
                let stroke = '#475569';
                if (isFocused) {
                  fill = '#4f46e5';
                  stroke = '#e0e7ff';
                } else if (isOutgoingTarget) {
                  fill = '#083344';
                  stroke = '#22d3ee';
                } else if (isIncomingSource) {
                  fill = '#451a03';
                  stroke = '#f59e0b';
                } else if (isEnd && !isStart) {
                  fill = '#1c1917';
                  stroke = '#f59e0b';
                } else if (isStart) {
                  fill = '#052e16';
                  stroke = '#10b981';
                }

                const textAnchor =
                  count === 1
                    ? 'middle'
                    : Math.abs(Math.cos(node.angle)) < 0.25
                      ? 'middle'
                      : Math.cos(node.angle) > 0
                        ? 'start'
                        : 'end';

                return (
                  <g
                    key={id}
                    transform={`translate(0,0)`}
                    className="cursor-pointer"
                    style={{ opacity: isDimmed ? 0.28 : 1, transition: 'opacity 150ms ease' }}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId((prev) => (prev === id ? null : prev))}
                    onClick={() => setSelectedId((prev) => (prev === id ? null : id))}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={nodeR}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isFocused ? 3 : 2}
                    />
                    <text
                      x={node.x}
                      y={node.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontSize={count > 24 ? 11 : 13}
                      fontWeight={700}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    >
                      {count > 28 ? `${id}` : `P${id}`}
                    </text>

                    {/* Outer QR linkid label */}
                    <text
                      x={node.labelX}
                      y={node.labelY}
                      textAnchor={textAnchor}
                      dominantBaseline="central"
                      fill={isFocused ? '#e2e8f0' : '#94a3b8'}
                      fontSize={11}
                      fontWeight={isFocused ? 600 : 500}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    >
                      {node.puzzle.linkid}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* Right: Flow Inspector & Connection Summary */}
      <div className="xl:col-span-4 rounded-xl border border-slate-800/80 bg-[#0E1420] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {activeNode ? `Puzzle P${activeNode.puzzle.id} Flow` : 'Flow Summary'}
          </h3>
          {activeNode && (
            <div className="flex items-center gap-1.5">
              {onShowQr && (
                <button
                  type="button"
                  onClick={() => onShowQr(activeNode.puzzle)}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3 h-3" />
                  <span>QR</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onEditPuzzle(activeNode.puzzle)}
                className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto max-h-[560px]">
          {/* Compact 3-stat strip */}
          <div className="grid grid-cols-3 rounded-lg border border-slate-800/80 bg-[#090D16] divide-x divide-slate-800/80 text-center">
            <div className="py-2.5 px-2">
              <div className="text-[11px] text-slate-400">Nodes</div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums mt-0.5">
                {count}
              </div>
            </div>
            <div className="py-2.5 px-2">
              <div className="text-[11px] text-slate-400">Links</div>
              <div className="text-sm font-semibold text-cyan-300 font-mono tabular-nums mt-0.5">
                {totalValidLinks}
              </div>
            </div>
            <div className="py-2.5 px-2">
              <div className="text-[11px] text-slate-400">End Nodes</div>
              <div className="text-sm font-semibold text-amber-300 font-mono tabular-nums mt-0.5">
                {endNodes.length}
              </div>
            </div>
          </div>

          {activeNode ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-800/80 bg-[#090D16] p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white font-mono">
                    P{activeNode.puzzle.id} · {activeNode.puzzle.linkid}
                  </span>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    L{activeNode.puzzle.level} · {activeNode.puzzle.points} pts
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  {activeNode.puzzle.locationClue || 'Campus Signal Node'}
                </p>
                {activeNode.puzzle.startCode && (
                  <p className="text-xs text-emerald-400 font-mono">
                    Entry code: {activeNode.puzzle.startCode}
                  </p>
                )}
              </div>

              {/* Incoming Connections */}
              <div>
                <div className="text-xs font-medium text-amber-300 mb-2">
                  Incoming From ({activeNode.inDegree})
                </div>
                {activeNode.inDegree === 0 ? (
                  <p className="text-xs text-slate-500">
                    None — this is a starting puzzle.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(incomingMap.get(activeNode.puzzle.id) || []).map((srcId) => {
                      const srcP = puzzleById.get(srcId);
                      return (
                        <button
                          key={srcId}
                          type="button"
                          onClick={() => setSelectedId(srcId)}
                          className="px-2.5 py-1.5 rounded-md border border-amber-500/30 bg-amber-950/30 hover:bg-amber-900/40 text-amber-200 text-xs font-mono cursor-pointer"
                        >
                          P{srcId} {srcP ? `(${srcP.linkid})` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Outgoing Connections */}
              <div>
                <div className="text-xs font-medium text-cyan-300 mb-2">
                  Leads To ({activeNode.outDegree})
                </div>
                {activeNode.outDegree === 0 ? (
                  <p className="text-xs text-slate-500">
                    None — final puzzle in this branch.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(outgoingMap.get(activeNode.puzzle.id) || []).map((dstId) => {
                      const dstP = puzzleById.get(dstId);
                      return (
                        <button
                          key={dstId}
                          type="button"
                          onClick={() => setSelectedId(dstId)}
                          className="px-2.5 py-1.5 rounded-md border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-200 text-xs font-mono inline-flex items-center gap-1 cursor-pointer"
                        >
                          <ArrowRight className="w-3 h-3" />
                          <span>
                            P{dstId} {dstP ? `(${dstP.linkid})` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {startNodes.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1.5">
                    Entry Puzzles
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {startNodes.map((n) => (
                      <button
                        key={n.puzzle.id}
                        type="button"
                        onClick={() => setSelectedId(n.puzzle.id)}
                        className="px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 text-xs font-mono cursor-pointer"
                      >
                        P{n.puzzle.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-slate-300 mb-2">
                  All Puzzle Links
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-[#090D16] divide-y divide-slate-800/70">
                  {sortedPuzzles.map((p) => {
                    const targets = outgoingMap.get(p.id) || [];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs hover:bg-slate-800/40 transition-colors cursor-pointer"
                      >
                        <span className="font-mono font-medium text-white shrink-0">
                          P{p.id}{' '}
                          <span className="text-slate-500 font-normal">{p.linkid}</span>
                        </span>
                        <span className="font-mono text-slate-400 truncate flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span>
                            {targets.length > 0
                              ? targets.map((t) => `P${t}`).join(', ')
                              : 'End'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {missingLinks.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/25 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Missing Target IDs</span>
              </div>
              <div className="text-xs font-mono text-rose-200/90 space-y-0.5">
                {missingLinks.map((m, idx) => (
                  <div key={`${m.fromId}-${m.toId}-${idx}`}>
                    P{m.fromId} → P{m.toId} (not created yet)
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
