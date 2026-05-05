import type {
  WorkstreamStatus,
  WorkstreamVisualState,
  StationType,
  StationVisualState,
  LineTexture,
} from '../../../extension/types/workstreamTypes';

export const STATUS_COLORS: Record<WorkstreamStatus, string> = {
  active: '#4A9EFF',
  completed: '#4ADE80',
  blocked: '#F87171',
  uncertain: '#FACC15',
  research: '#A78BFA',
  abandoned: '#9CA3AF',
  planning: '#7DD3FC',
};

export const GLOW_COLORS = {
  recent: '#4A9EFF',
  attention: '#F87171',
  resolved: '#4ADE80',
  uncertain: '#FACC15',
  none: 'transparent',
};

export function getStationShape(type: StationType): string {
  const shapes: Record<StationType, string> = {
    session: 'circle',
    decision: 'diamond',
    code_change: 'square',
    problem: 'triangle',
    milestone: 'star',
    failure: 'x',
    uncertainty: 'question',
    blocker: 'lock',
    direction_change: 'curved-arrow',
    merge_point: 'junction',
    split_point: 'junction',
    plan_step: 'outlined-circle',
  };
  return shapes[type] ?? 'circle';
}

export function getStationSize(size: StationVisualState['size']): number {
  switch (size) {
    case 'large': return 20;
    case 'medium': return 14;
    case 'small': return 10;
  }
}

export function getLineDashArray(texture: LineTexture): string {
  switch (texture) {
    case 'solid': return '';
    case 'dashed': return '8,4';
    case 'blurred': return '2,2';
    case 'broken': return '4,8';
  }
}

export function getLineFilter(texture: LineTexture): string {
  if (texture === 'blurred') { return 'url(#blur-filter)'; }
  return '';
}

export function getGlowFilter(glow: StationVisualState['glow']): string {
  if (glow === 'none') { return ''; }
  return `url(#glow-${glow})`;
}

export function statusToLineStyle(visual: WorkstreamVisualState) {
  return {
    stroke: visual.colorToken,
    strokeWidth: visual.thickness,
    strokeDasharray: getLineDashArray(visual.texture),
    opacity: visual.opacity,
    filter: getLineFilter(visual.texture),
  };
}
