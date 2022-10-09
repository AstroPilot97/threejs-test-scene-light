import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import GUI from "lil-gui";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";
import {
  BlendFunction,
  KernelSize,
  EffectComposer,
  EffectPass,
  BloomEffect,
  RenderPass,
} from "postprocessing";
import WebGL from "three/examples/jsm/capabilities/WebGL.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { MathUtils } from "three";
import { saveAs } from "file-saver";
import Moment from "moment";

if (WebGL.isWebGL2Available() === false) {
  document.body.appendChild(WebGL.getWebGL2ErrorMessage());
}

// Global variables
let clock, renderer, scene, camera, timer, gui;
let sky,
  sun,
  sunLight,
  sunEffectController,
  phi,
  theta,
  cloudMesh,
  clouds,
  groundPlaneMesh;
let stats, textureLoader, gltfLoader;
let mixers = [],
  cameraPositions = [];
let currentPosition;
let renderScene, composer;
let instancedTrees;
let fps, delta;
let testResults = [],
  times = [],
  memoryUsage = [];
let sizes = { width: 1920, height: 1080 };
let refreshRate = 0;
let readyToTest = false; // Flag to halt any testing logic before full asset load
let msaaSamples;

//Init scene and render animation loop
initRenderer();
init();
animate();

function init() {
  // Clock
  clock = new THREE.Clock();
  timer = new THREE.Clock(false);

  // Debug
  gui = new GUI();

  // Scene
  scene = new THREE.Scene();

  // Texture loader
  textureLoader = new THREE.TextureLoader();

  // Models
  gltfLoader = new GLTFLoader();
  loadBalloonModels();
  initForests();

  window.addEventListener("resize", () => {
    // Update sizes
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;

    // Update camera
    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    // Update renderer
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  /**
   * Camera
   */
  // Base camera
  camera = new THREE.PerspectiveCamera(
    75,
    sizes.width / sizes.height,
    0.1,
    3000
  );
  camera.position.x = 0;
  camera.position.y = 0;
  camera.position.z = 15;
  scene.add(camera);

  // Camera position loop
  currentPosition = 0;
  cameraPositions = [
    [0, 0, 15],
    [50, -90, 120],
    [1, 60, 0],
    [60, 5, 15],
    [-50, 15, -55],
  ];

  // Stats
  stats = new Stats();
  const panels = [0, 1, 2]; // 0: fps, 1: ms, 2: mb
  Array.from(stats.dom.children).forEach((child, index) => {
    child.style.display = panels.includes(index) ? "inline-block" : "none";
  });
  document.body.appendChild(stats.dom);

  // Hemisphere light
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  hemiLight.color.setHSL(0.6, 0.75, 0.5);
  hemiLight.groundColor.setHSL(0.095, 0.5, 0.5);
  scene.add(hemiLight);

  // Init sky
  initSky();

  // Init clouds
  initClouds();

  // Init ground plane
  initGroundPlane();

  // Init post-processing
  initPostProcessing();

  // Test controls
  initBenchmarkControls();
  initTestResultControls();
}

function initRenderer() {
  // Canvas
  const canvas = document.querySelector("canvas.webgl");

  /**
   * Renderer
   */
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: false,
    stencil: false,
    depth: false,
    powerPreference: "high-performance",
  });
  renderer.setSize(sizes.width, sizes.height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

// Animate
function animate() {
  // Call tick again on the next frame
  delta = clock.getDelta();
  setTimeout(function () {
    requestAnimationFrame(animate);
  }, 1000 / refreshRate);

  // Update objects
  if (mixers) {
    mixers.forEach((mixer) => {
      mixer.update(delta);
    });
  }
  if (clouds) {
    clouds.forEach((cloud) => {
      cloud.material.uniforms.cameraPos.value.copy(camera.position);
      cloud.material.uniforms.frame.value++;
      if (readyToTest) cloud.position.x += 0.05;
    });
  }

  if (groundPlaneMesh && readyToTest) groundPlaneMesh.position.x += 0.05;
  if (instancedTrees && readyToTest) instancedTrees.position.x += 0.05;
  if (instancedTrees && instancedTrees.position.x > 1600)
    instancedTrees.position.x = 0;
  if (groundPlaneMesh && groundPlaneMesh.position.x > 1300)
    groundPlaneMesh.position.x = -300;

  if (sun && sunLight && sunEffectController && readyToTest) {
    sunEffectController.elevation -= 0.05;
    phi = THREE.MathUtils.degToRad(90 - sunEffectController.elevation);
    theta = THREE.MathUtils.degToRad(sunEffectController.azimuth);

    sun.setFromSphericalCoords(1, phi, theta);
    sunLight.position.setFromSphericalCoords(50, phi, theta);
    sky.material.uniforms.sunPosition.value.copy(sun);
    sunLight.castShadow = sunLight.position.y > 0;
    renderer.toneMappingExposure = sunLight.position.y > -3 ? 0.35 : 0.1;
  }

  // Render
  composer.render(delta);

  // Stats update
  stats.update();

  // Fps counter loop
  if (readyToTest) fpsCounterLoop();

  //Three-Devtools API
  if (typeof __THREE_DEVTOOLS__ !== "undefined") {
    __THREE_DEVTOOLS__.dispatchEvent(
      new CustomEvent("observe", { detail: scene })
    );
    __THREE_DEVTOOLS__.dispatchEvent(
      new CustomEvent("observe", { detail: renderer })
    );
  }
}

// Balloons
function loadBalloonModels() {
  let balloonPlacements = [
    new THREE.Vector3(0, 5, 0),
    new THREE.Vector3(25, 15, -25),
    new THREE.Vector3(14, -5, 28),
    new THREE.Vector3(-20, 7, -19),
    new THREE.Vector3(-30, 10, 35),
    new THREE.Vector3(-60, -10, 35),
  ];

  for (let i = 0; i < balloonPlacements.length; i++) {
    gltfLoader.load("models/peachy_balloon/scene.glb", (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.005, 0.005, 0.005);
      model.rotateY(Math.PI);
      model.translateOnAxis(balloonPlacements[i], 1);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach((clip) => {
        mixer.clipAction(clip).play();
      });
      mixers.push(mixer);

      model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      scene.add(model);
      if (i == balloonPlacements.length - 1) {
        document.getElementById("loader").style.display = "none";
      }
    });
  }
}

// Forests
function initForests() {
  gltfLoader.load("models/pine_tree/scene.glb", (gltf) => {
    const model = gltf.scene;
    model.traverse(function (node) {
      if (node.isMesh) {
        instancedTrees = new THREE.InstancedMesh(
          node.geometry,
          node.material,
          30000
        );

        for (let i = 0; i < instancedTrees.count; i++) {
          var dummy = new THREE.Object3D();
          dummy.rotation.set(-1.5, 0, MathUtils.randFloat(-3, 3));
          dummy.scale.set(5, 5, 5);
          dummy.position.set(
            MathUtils.randFloat(-2000, 2000),
            MathUtils.randFloat(-90, -88),
            MathUtils.randFloat(-2000, 2000)
          );
          dummy.updateMatrix();
          instancedTrees.setMatrixAt(i, dummy.matrix);
        }
        instancedTrees.castShadow = true;
        instancedTrees.receiveShadow = true;
        instancedTrees.frustumCulled = false;
        scene.add(instancedTrees);
      }
    });
  });
}

// Sky
function initSky() {
  // Add Sky
  sky = new Sky();
  sky.scale.setScalar(100000);
  scene.add(sky);
  sun = new THREE.Vector3();

  // Sun light
  sunLight = new THREE.DirectionalLight(0xffffff, 3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0009;
  sunLight.shadow.camera.left = -30;
  sunLight.shadow.camera.right = 30;
  sunLight.shadow.camera.top = 30;
  sunLight.shadow.camera.bottom = -30;
  scene.add(sunLight);

  const opposingLight = sunLight.clone();
  opposingLight.castShadow = false;
  opposingLight.intensity = sunLight.intensity - 2;
  scene.add(opposingLight);

  /// GUI
  sunEffectController = {
    turbidity: 5.5,
    rayleigh: 1.1,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.975,
    elevation: 160,
    exposure: renderer.toneMappingExposure,
    azimuth: 60,
  };

  function guiChanged() {
    const uniforms = sky.material.uniforms;
    uniforms["turbidity"].value = sunEffectController.turbidity;
    uniforms["rayleigh"].value = sunEffectController.rayleigh;
    uniforms["mieCoefficient"].value = sunEffectController.mieCoefficient;
    uniforms["mieDirectionalG"].value = sunEffectController.mieDirectionalG;

    phi = THREE.MathUtils.degToRad(90 - sunEffectController.elevation);
    theta = THREE.MathUtils.degToRad(sunEffectController.azimuth);

    sun.setFromSphericalCoords(1, phi, theta);
    sunLight.position.setFromSphericalCoords(50, phi, theta);

    uniforms["sunPosition"].value.copy(sun);

    renderer.toneMappingExposure = sunEffectController.exposure;
  }

  guiChanged();
}

function initClouds() {
  // Texture
  const size = 128;
  const data = new Uint8Array(size * size * size);
  let i = 0;
  const scale = 0.05;
  const perlin = new ImprovedNoise();
  const vector = new THREE.Vector3();

  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d =
          1.0 -
          vector
            .set(x, y, z)
            .subScalar(size / 2)
            .divideScalar(size)
            .length();
        data[i] =
          (128 +
            128 *
              perlin.noise((x * scale) / 1.5, y * scale, (z * scale) / 1.5)) *
          d *
          d;
        i++;
      }
    }
  }

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // Geometry
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      base: { value: new THREE.Color(0x798aa0) },
      map: { value: texture },
      cameraPos: { value: new THREE.Vector3() },
      threshold: { value: 0.25 },
      opacity: { value: 0.3 },
      range: { value: 0.05 },
      steps: { value: 30 },
      frame: { value: 0 },
    },
    vertexShader: document.getElementById("cloudVS").textContent,
    fragmentShader: document.getElementById("cloudFS").textContent,
    side: THREE.BackSide,
    transparent: true,
  });

  clouds = [];

  const cloudPlacement = [
    new THREE.Vector3(547, 55, 957),
    new THREE.Vector3(-800, 400, 500),
    new THREE.Vector3(-239, 103, 521),
    new THREE.Vector3(-650, 0, 450),
    new THREE.Vector3(398, 52, -197),
    new THREE.Vector3(-140, 4, 20),
  ];

  const cloudScaling = [
    [1526, 306, 1152],
    [1500, 150, 1850],
    [470, 220, 442],
    [300, 140, 400],
    [914, 82, 643],
    [100, 70, 150],
  ];

  for (let i = 0; i < cloudPlacement.length; i++) {
    cloudMesh = new THREE.Mesh(geometry, material);
    cloudMesh.translateOnAxis(cloudPlacement[i], 1);
    cloudMesh.scale.set(
      cloudScaling[i][0],
      cloudScaling[i][1],
      cloudScaling[i][2]
    );
    cloudMesh.renderOrder = i;
    clouds.push(cloudMesh);
    scene.add(cloudMesh);
  }
}

function initGroundPlane() {
  const groundPlaneTex1 = textureLoader.load("textures/mountains/mntn-tex.jpg");
  const groundPlaneDisp1 = textureLoader.load(
    "textures/mountains/DisplacementMap.png"
  );
  groundPlaneTex1.anisotropy = 16;
  groundPlaneTex1.wrapS = THREE.RepeatWrapping;
  groundPlaneTex1.wrapT = THREE.RepeatWrapping;
  groundPlaneDisp1.wrapS = THREE.RepeatWrapping;
  groundPlaneDisp1.wrapT = THREE.RepeatWrapping;
  groundPlaneTex1.repeat.set(16, 16);
  groundPlaneDisp1.repeat.set(16, 8);
  const groundPlaneGeo = new THREE.PlaneGeometry(4096, 4096, 24, 24);
  const groundPlaneMat1 = new THREE.MeshStandardMaterial({
    map: groundPlaneTex1,
    displacementMap: groundPlaneDisp1,
    displacementScale: 1024,
  });
  groundPlaneMesh = new THREE.Mesh(groundPlaneGeo, groundPlaneMat1);
  groundPlaneMesh.rotateX(-Math.PI / 2);
  groundPlaneMesh.translateOnAxis(new THREE.Vector3(-300, -0, -100), 1);
  scene.add(groundPlaneMesh);
}

function initPostProcessing() {
  renderScene = new RenderPass(scene, camera);
  composer = new EffectComposer(renderer, { multisampling: 0 });
  composer.addPass(renderScene);
  initBloom();
}

function initBloom() {
  const bloomOptions = {
    blendFunction: BlendFunction.SCREEN,
    kernelSize: KernelSize.MEDIUM,
    luminanceThreshold: 0.65,
    luminanceSmoothing: 0.2,
    height: 480,
  };
  const bloomPass = new EffectPass(camera, new BloomEffect(bloomOptions));
  composer.addPass(bloomPass);
}

function startClockTimer() {
  setInterval(function () {
    let elapsedTimeSeconds = Math.round(timer.getElapsedTime());
    let elapsedTimeMinutes = elapsedTimeSeconds / 60;
    elapsedTimeSeconds = Math.floor(elapsedTimeSeconds) % 60;
    elapsedTimeMinutes = Math.floor(elapsedTimeMinutes) % 60;
    let stringMinutes = elapsedTimeMinutes.toLocaleString();
    let stringSeconds = elapsedTimeSeconds.toLocaleString();
    if (elapsedTimeSeconds.toString().length < 2) {
      stringSeconds = "0" + stringSeconds;
    }
    document.getElementById(
      "timeElapsed"
    ).innerHTML = `Time elapsed: ${stringMinutes}:${stringSeconds}`;
    let memory = performance.memory;
    if (readyToTest) {
      testResults.push(fps);
      memoryUsage.push(Math.round(memory.usedJSHeapSize / 1048576));
    }
  }, 1000);
}

function initBenchmarkControls() {
  let resolutionObj = {
    resolution: "FullHD",
  };
  gui
    .add(resolutionObj, "resolution", ["FullHD", "WQHD", "4K"])
    .name("Resolution")
    .onChange((value) => {
      setResolution(value);
    });

  let refreshRateObj = {
    rate: 0,
  };

  gui
    .add(refreshRateObj, "rate", { Unlimited: 0, "60Hz": 60, "30Hz": 31 })
    .name("Refresh Rate")
    .onChange((value) => {
      refreshRate = value;
    });

  let antialiasingObj = {
    samples: 0,
  };

  gui
    .add(antialiasingObj, "samples", {
      Off: 0,
      "2x": 2,
      "4x": 4,
      "8x": 8,
      "16x": 16,
    })
    .name("Multisample Antialiasing")
    .onChange((value) => {
      composer.multisampling = value;
      msaaSamples = value;
    });

  let testButton = {
    BeginTest: function () {
      readyToTest = true;
      timer.start();
      // Camera animation loop
      beginCameraLoop();
      // Clock timer
      startClockTimer();
    },
  };
  gui.add(testButton, "BeginTest").name("Begin test");
}

function setResolution(resolution) {
  switch (resolution) {
    case "FullHD":
      sizes = {
        width: 1920,
        height: 1080,
      };
      break;
    case "WQHD":
      sizes = {
        width: 2560,
        height: 1440,
      };
      break;
    case "4K":
      sizes = {
        width: 3840,
        height: 2160,
      };
      break;
    default:
      sizes = {
        width: 1920,
        height: 1080,
      };
  }
  composer.setSize(sizes.width, sizes.height);
}

function initTestResultControls() {
  let controlObj = {
    SaveTestResults: function () {
      var testFile = new File(
        [
          `Three.js performance test results \n
          Testing date: ${Moment().toLocaleString()}; \n
          Resolution: width: ${sizes.width}, height: ${sizes.height} \n
          Refresh rate: ${refreshRate} \n
          MSAA: ${msaaSamples} \n
          Frames per second (each FPS count in array was ticked every second):
          ${testResults} \n
          Memory usage (in Megabytes):
          ${memoryUsage}
          `,
        ],
        "test_results.txt",
        {
          type: "text/plain;charset=utf-8",
        }
      );
      saveAs(testFile);
    },
  };

  gui.add(controlObj, "SaveTestResults").name("Save test results");
}

function fpsCounterLoop() {
  const now = performance.now();
  while (times.length > 0 && times[0] <= now - 1000) {
    times.shift();
  }
  times.push(now);
  fps = times.length;
}

function beginCameraLoop() {
  setInterval(function () {
    let indexPosition = ++currentPosition % cameraPositions.length;
    camera.position.set(
      cameraPositions[indexPosition][0],
      cameraPositions[indexPosition][1],
      cameraPositions[indexPosition][2]
    );
    camera.lookAt(0, 0, 0);
  }, 20000);
}
