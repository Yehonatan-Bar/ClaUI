import type {
  MapLayout,
  ProjectMapState,
  SvgPathDefinition,
  Workstream,
  Station,
  WorkstreamStatus,
} from '../../../extension/types/workstreamTypes';

const LANE_HEIGHT = 90;
const STATION_SPACING_X = 140;
const LABEL_AREA_WIDTH = 200;
const LINE_START_X = 220;
const PADDING = { top: 70, right: 80, bottom: 60, left: 16 };
const MAX_VISIBLE_LANES = 7;

const STATUS_PRIORITY: Record<WorkstreamStatus, number> = {
  blocked: 0,
  active: 1,
  uncertain: 2,
  research: 3,
  planning: 4,
  completed: 5,
  abandoned: 6,
};

export function computeLayout(state: ProjectMapState): MapLayout {
  const workstreams = sortWorkstreams(state.workstreams);
  const visibleWorkstreams = workstreams.filter(ws => !ws.visual.collapsed).slice(0, MAX_VISIBLE_LANES);

  const workstreamPaths: Record<string, SvgPathDefinition> = {};
  const stationPositions: Record<string, { x: number; y: number }> = {};
  const labelPositions: Record<string, { x: number; y: number }> = {};
  const junctionPositions: Record<string, { x: number; y: number }> = {};

  let maxX = 0;

  visibleWorkstreams.forEach((ws, laneIndex) => {
    const y = PADDING.top + laneIndex * LANE_HEIGHT;
    const wsStations = state.stations
      .filter(s => s.workstreamId === ws.id && s.visibleInProjectMap)
      .sort((a, b) => a.order - b.order);

    const points: Array<{ x: number; y: number }> = [];
    const startX = LINE_START_X;

    if (wsStations.length === 0) {
      const endX = startX + STATION_SPACING_X;
      points.push({ x: startX, y }, { x: endX, y });
      maxX = Math.max(maxX, endX);
    } else {
      wsStations.forEach((station, stationIdx) => {
        const x = LINE_START_X + (stationIdx + 1) * STATION_SPACING_X;
        points.push({ x, y });
        stationPositions[station.id] = { x, y };
        labelPositions[station.id] = { x, y: y - 22 };
        maxX = Math.max(maxX, x);
      });
    }

    labelPositions[ws.id] = { x: PADDING.left, y };

    // Generate SVG path
    const pathD = generateSmoothPath(points, startX, y);

    workstreamPaths[ws.id] = {
      d: pathD,
      color: ws.visual.colorToken,
      texture: ws.visual.texture,
      thickness: ws.visual.thickness,
      opacity: ws.visual.opacity,
    };
  });

  // Position split/merge junctions
  for (const split of state.splits) {
    const sourceStation = stationPositions[split.stationId];
    if (sourceStation) {
      junctionPositions[split.id] = { x: sourceStation.x, y: sourceStation.y };
    }
  }
  for (const merge of state.merges) {
    const mergeStation = stationPositions[merge.stationId];
    if (mergeStation) {
      junctionPositions[merge.id] = { x: mergeStation.x, y: mergeStation.y };
    }
  }

  return {
    workstreamPaths,
    stationPositions,
    labelPositions,
    junctionPositions,
    bounds: {
      width: maxX + PADDING.right,
      height: PADDING.top + visibleWorkstreams.length * LANE_HEIGHT + PADDING.bottom,
    },
  };
}

function sortWorkstreams(workstreams: Workstream[]): Workstream[] {
  return [...workstreams].sort((a, b) => {
    // Pinned first
    if (a.userPinned && !b.userPinned) { return -1; }
    if (!a.userPinned && b.userPinned) { return 1; }

    // Then by status priority
    const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (statusDiff !== 0) { return statusDiff; }

    // Then by importance
    if (b.importanceScore !== a.importanceScore) {
      return b.importanceScore - a.importanceScore;
    }

    // Then by recent activity
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

function generateSmoothPath(
  points: Array<{ x: number; y: number }>,
  startX: number,
  startY: number,
): string {
  if (points.length === 0) {
    return `M ${startX} ${startY} L ${startX + 100} ${startY}`;
  }

  let d = `M ${startX} ${startY}`;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) {
      // Smooth curve from start to first station
      const cx = (startX + p.x) / 2;
      d += ` C ${cx} ${startY}, ${cx} ${p.y}, ${p.x} ${p.y}`;
    } else {
      const prev = points[i - 1];
      if (prev.y === p.y) {
        d += ` L ${p.x} ${p.y}`;
      } else {
        const cx = (prev.x + p.x) / 2;
        d += ` C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
      }
    }
  }

  // Extend line slightly past last station
  const last = points[points.length - 1];
  d += ` L ${last.x + 30} ${last.y}`;

  return d;
}
