export type Pose = { yaw: number; pitch: number; roll: number };
export type Observation = 'NO_FACE' | 'MULTIPLE_FACES' | 'ONE_FACE' | 'HEAD_TURN' | 'HEAD_TILT' | 'POSE_UNAVAILABLE';
export const labels: Record<Observation, string> = {
  NO_FACE: 'No face detected', MULTIPLE_FACES: 'Two or more faces detected', ONE_FACE: 'One face detected',
  HEAD_TURN: 'Head turned from reference', HEAD_TILT: 'Head tilted from reference', POSE_UNAVAILABLE: 'Face detected; direction unavailable'
};
export function matrixPose(matrix: number[] | null): Pose | null {
  if (!matrix || matrix.length !== 16 || matrix.some(n => !Number.isFinite(n))) return null;
  // Column-major canonical-face transform; normalize each axis to remove scale.
  const nx = Math.hypot(matrix[0], matrix[1], matrix[2]);
  const ny = Math.hypot(matrix[4], matrix[5], matrix[6]);
  const nz = Math.hypot(matrix[8], matrix[9], matrix[10]);
  if (Math.min(nx, ny, nz) < 0.00001) return null;
  const deg = 180 / Math.PI;
  return { yaw: Math.atan2(matrix[8] / nz, matrix[10] / nz) * deg,
    pitch: Math.atan2(-matrix[9] / nz, Math.hypot(matrix[8] / nz, matrix[10] / nz)) * deg,
    roll: Math.atan2(matrix[1] / nx, matrix[5] / ny) * deg };
}
const angle = (a: number, b: number) => ((a - b + 540) % 360) - 180;
export function poseDifference(pose: Pose, reference: Pose): Pose {
  return { yaw: angle(pose.yaw, reference.yaw), pitch: angle(pose.pitch, reference.pitch), roll: angle(pose.roll, reference.roll) };
}
export function classify(count: number, delta: Pose | null): Observation {
  if (count === 0) return 'NO_FACE';
  if (count > 1) return 'MULTIPLE_FACES';
  if (!delta) return 'POSE_UNAVAILABLE';
  if (Math.abs(delta.yaw) >= 20) return 'HEAD_TURN';
  if (Math.abs(delta.pitch) >= 15 || Math.abs(delta.roll) >= 15) return 'HEAD_TILT';
  return 'ONE_FACE';
}
export type ObservationEvent = { kind: Observation; at: number; durationMs: number };
// Consecutive results only: disconnected cameras, stalled inference and background tabs
// must never be interpreted as a sustained absence.
export class ObservationTimeline {
  private last = -1;
  private since = 0;
  private pending: Observation | null = null;
  private emitted: Observation | null = null;
  update(kind: Observation, at: number): ObservationEvent | null {
    if (!Number.isFinite(at) || at <= this.last) return null;
    if (this.last < 0 || at - this.last > 1500) { this.pending = null; this.emitted = null; }
    this.last = at;
    if (kind !== this.pending) { this.pending = kind; this.since = at; }
    const durationMs = at - this.since;
    const dwell = kind === 'NO_FACE' ? 10000 : kind === 'ONE_FACE' ? 1000 : 2000;
    if (durationMs < dwell || this.emitted === kind) return null;
    this.emitted = kind;
    return { kind, at, durationMs };
  }
}
