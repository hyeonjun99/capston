const NUM_KEYPOINTS = 468;
const NUM_IRIS_KEYPOINTS = 5;
const GREEN = '#32EEDB';
const RED = "#FF2C35";
const BLUE = "#157AB3";

let eyeClosedTime = 0;
const eyeClosedThreshold = 5000; // 5초
const eyeOpenThreshold = 0.2; // 눈이 감겼는지 여부를 판단하는 임계값

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

function distance(a, b) {
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
}

function drawPath(ctx, points, closePath) {
  const region = new Path2D();
  region.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    region.lineTo(point[0][0], point[0][1]);
  }

  if (closePath) {
    region.closePath();
  }
  ctx.stroke(region);
}

let model, ctx, videoWidth, videoHeight, video, canvas,
    scatterGLHasInitialized = false, scatterGL, rafID;

const VIDEO_SIZE = 500;
const mobile = isMobile();
const renderPointcloud = mobile === false;
const stats = new Stats();
const state = {
  backend: 'webgl',
  maxFaces: 1,
  triangulateMesh: true,
  predictIrises: true
};

if (renderPointcloud) {
  state.renderPointcloud = true;
}

function setupDatGui() {
  const gui = new dat.GUI();
  gui.add(state, 'backend', ['webgl', 'wasm', 'cpu'])
      .onChange(async backend => {
        window.cancelAnimationFrame(rafID);
        await tf.setBackend(backend);
        requestAnimationFrame(renderPrediction);
      });

  gui.add(state, 'maxFaces', 1, 20, 1).onChange(async val => {
    model = await faceLandmarksDetection.load(
      faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
      {maxFaces: val});
  });

  gui.add(state, 'triangulateMesh');
  gui.add(state, 'predictIrises');

  if (renderPointcloud) {
    gui.add(state, 'renderPointcloud').onChange(render => {
      document.querySelector('#scatter-gl-container').style.display =
          render ? 'inline-block' : 'none';
    });
  }
}

async function setupCamera() {
  video = document.getElementById('video');

  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      width: mobile ? undefined : VIDEO_SIZE,
      height: mobile ? undefined : VIDEO_SIZE
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

function isEyeClosed(eye) {
    const eyeWidth = distance(eye[0], eye[4]);
    const eyeHeight = (distance(eye[1], eye[5]) + distance(eye[2], eye[6]) + distance(eye[3], eye[7])) / 3;
    return eyeHeight / eyeWidth < eyeOpenThreshold;
}

function showAlertMessage() {
    const alertMessage = document.getElementById('alert-message');
    alertMessage.style.display = 'block';
    setTimeout(() => {
        alertMessage.style.display = 'none';
    }, 3000); // 3초 후에 알림 메시지 숨김
}

function checkEyes(predictions) {
    if (predictions.length > 0) {
        const keypoints = predictions[0].scaledMesh;

        const leftEye = keypoints.slice(33, 41);
        const rightEye = keypoints.slice(362, 370);

        if (isEyeClosed(leftEye) && isEyeClosed(rightEye)) {
            eyeClosedTime += 100; // 100ms마다 호출됨을 가정
        } else {
            eyeClosedTime = 0;
        }

        if (eyeClosedTime >= eyeClosedThreshold) {
            showAlertMessage(); // 화면에 알림 메시지 표시
            eyeClosedTime = 0; // 알림 후 타이머 리셋
        }
    }
}

async function renderPrediction() {
  stats.begin();

  const predictions = await model.estimateFaces({
    input: video,
    returnTensors: false,
    flipHorizontal: false,
    predictIrises: state.predictIrises
  });
  ctx.drawImage(
      video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);

  if (predictions.length > 0) {
    predictions.forEach(prediction => {
      const keypoints = prediction.scaledMesh;

      if (state.triangulateMesh) {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 0.5;

        for (let i = 0; i < TRIANGULATION.length / 3; i++) {
          const points = [
            TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
            TRIANGULATION[i * 3 + 2]
          ].map(index => keypoints[index]);

          drawPath(ctx, points, true);
        }
      } else {
        ctx.fillStyle = GREEN;

        for (let i = 0; i < NUM_KEYPOINTS; i++) {
          const x = keypoints[i][0];
          const y = keypoints[i][1];

          ctx.beginPath();
          ctx.arc(x, y, 1 /* radius */, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      if(keypoints.length > NUM_KEYPOINTS) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1;

        const leftCenter = keypoints[NUM_KEYPOINTS];
        const leftDiameterY = distance(
          keypoints[NUM_KEYPOINTS + 4],
          keypoints[NUM_KEYPOINTS + 2]);
        const leftDiameterX = distance(
          keypoints[NUM_KEYPOINTS + 3],
          keypoints[NUM_KEYPOINTS + 1]);

        ctx.beginPath();
        ctx.ellipse(leftCenter[0], leftCenter[1], leftDiameterX / 2, leftDiameterY / 2, 0, 0, 2 * Math.PI);
        ctx.stroke();

        if(keypoints.length > NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS) {
          const rightCenter = keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS];
          const rightDiameterY = distance(
            keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 2],
            keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 4]);
          const rightDiameterX = distance(
            keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 3],
            keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 1]);

          ctx.beginPath();
          ctx.ellipse(rightCenter[0], rightCenter[1], rightDiameterX / 2, rightDiameterY / 2, 0, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    });

    checkEyes(predictions); // 눈 감김 여부 체크 함수 호출

    if (renderPointcloud && state.renderPointcloud && scatterGL != null) {
      const pointsData = predictions.map(prediction => {
        let scaledMesh = prediction.scaledMesh;
        return scaledMesh.map(point => ([-point[0], -point[1], -point[2]]));
      });

      let flattenedPointsData = [];
      for (let i = 0; i < pointsData.length; i++) {
        flattenedPointsData = flattenedPointsData.concat(pointsData[i]);
      }
      const dataset = new ScatterGL.Dataset(flattenedPointsData);

      if (!scatterGLHasInitialized) {
        scatterGL.setPointColorer((i) => {
          if(i % (NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS * 2) > NUM_KEYPOINTS) {
            return RED;
          }
          return BLUE;
        });
        scatterGL.render(dataset);
      } else {
        scatterGL.updateDataset(dataset);
      }
      scatterGLHasInitialized = true;
    }
  }

  stats.end();
  rafID = requestAnimationFrame(renderPrediction);
};

async function main() {
  await tf.setBackend(state.backend);
  setupDatGui();

  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.getElementById('main').appendChild(stats.dom);

  await setupCamera();
  video.play();
  videoWidth = video.videoWidth;
  videoHeight = video.videoHeight;
  video.width = videoWidth;
  video.height = videoHeight;

  canvas = document.getElementById('output');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const canvasContainer = document.querySelector('.canvas-wrapper');
  canvasContainer.style = `width: ${videoWidth}px; height: ${videoHeight}px`;

  ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = GREEN;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 0.5;

  model = await faceLandmarksDetection.load(
    faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
    {maxFaces: state.maxFaces});
  renderPrediction();

  if (renderPointcloud) {
    document.querySelector('#scatter-gl-container').style =
        `width: ${VIDEO_SIZE}px; height: ${VIDEO_SIZE}px;`;

    scatterGL = new ScatterGL(
        document.querySelector('#scatter-gl-container'),
        {'rotateOnStart': false, 'selectEnabled': false});
  }
};

main();
