/* Classic worker: MediaPipe's WASM loader uses importScripts. All assets are same-origin. */
let model;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      importScripts('./webcam-model/vision_bundle.js');
      const files = await Vision.FilesetResolver.forVisionTasks(new URL('./webcam-model/wasm', self.location.href).href);
      model = await Vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('./webcam-model/face_landmarker.task', self.location.href).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 2,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true
      });
      self.postMessage({ type: 'ready' });
    } catch {
      self.postMessage({ type: 'error', message: 'Could not load the webcam model. Ask the developer to run npm run setup:webcam, then retry in a supported browser.' });
    }
    return;
  }
  if (data.type !== 'frame') return;
  try {
    const started = performance.now();
    const result = model.detectForVideo(data.bitmap, data.timestamp);
    const boxes = result.faceLandmarks.map(points => {
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
      return { x, y, width: Math.max(0, Math.min(1, Math.max(...xs)) - x), height: Math.max(0, Math.min(1, Math.max(...ys)) - y) };
    });
    self.postMessage({ type: 'result', timestamp: data.timestamp, count: boxes.length, boxes,
      matrix: boxes.length === 1 ? result.facialTransformationMatrixes[0]?.data ?? null : null,
      inferenceMs: performance.now() - started });
  } catch {
    self.postMessage({ type: 'error', message: 'Face detection stopped unexpectedly. Stop and restart the camera test.' });
  } finally { data.bitmap.close(); }
};
