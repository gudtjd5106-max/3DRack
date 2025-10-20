import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/OrbitControls.js';
import { DragControls } from 'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/DragControls.js';
import * as BufferGeometryUtils from 'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/geometries/ConvexGeometry.js';


// DOM 요소
const container = document.getElementById('viewport-3d');

// 기본 Three.js 구성
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6e9);

const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 100000);
camera.position.set(800, 800, 1000);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);
// [PERF] 프레임마다 자동 리셋
renderer.info.autoReset = true;

// [PERF] 화면 좌상단에 수치 표시용 DOM 생성
const perfBox = document.createElement('div');
perfBox.id = 'perf-box';
perfBox.style.cssText = 'position:fixed;left:10px;top:10px;background:rgba(0,0,0,0.6);color:#0f0;padding:8px 10px;font:12px/1.4 monospace;z-index:9999;white-space:pre;pointer-events:none;';
document.body.appendChild(perfBox);
let isPerfVisible = false;
perfBox.style.display = 'none';

// 오른쪽 버튼 선택 무시
renderer.domElement.addEventListener('pointerdown', (event) => {
  // 오른쪽 버튼이면 dragControls 강제 비활성화
  if (event.button === 2) {
    dragControls.enabled = false;
  }
  if (event.ctrlKey) {
    event.stopImmediatePropagation();
    return;
  }
});
let lastMouseX = 0, lastMouseY = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});
function updateRayFromLastMouse() {
  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((lastMouseX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((lastMouseY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
}
renderer.domElement.addEventListener('pointerup', () => {
  dragControls.enabled = true;
});

// 셀 및 그리드 크기 지정 (랙 간격)
const cellW = 100, cellH = 60, cellD = 100;

let gridWidth = 6200;
let gridDepth = 6200;
let floorMesh = null; // 바닥 그리드를 엣지 기준 셀에 맞춰 직관적으로 생성
let floorOffsetX = 0;
let floorOffsetZ = 0;
const gridHelper = new THREE.Group();

// 광원 설정
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const light = new THREE.DirectionalLight(0xffffff, 0.6);
light.position.set(300, 2000, 1000);
light.castShadow = true;
scene.add(light);

// 편집 상태 변수
let isEditMode = true; // true면 편집 가능, false면 읽기전용 모드

// 전역 상태 관리
const rackGroups = [];
const dragHandles = [];
const selectionBox = document.getElementById('selectionBox');
let selectedGroup = null;
let dragControls;
let activeDragGroup = null;
let originalCameraState = null;  // 첫 상태
let isCameraChanged = false;
let isSelecting = false;
let selectionStart = { x: 0, y: 0 };
let selectedRackGroups = [];
let skipNextClick = false;  // 선택 오작동 방지
let draggingGroups = [];
let copiedRackData = [];
let isBoxSelectMode = false;
let selectedBox = null;
let previewRack = null;
let currentPreviewMode = null; // 'rack' | 'pallet' | null
let markingLines = [];
let selectedMarkingLine = null;
let selectedMarkingLines = [];
let isLineDrawingMode = false;
let lastLinePoint = null;
let previewLine = null;
let activePolyline = null;
let activePolylinePoints = [];
let previewSnapLock = { locked: false, target: null, y: 0 };
let dragSnapLock = { active: false, locked: false, target: null, y: 0 };
let isMultiDragging = false;
let multiDragAnchor = null;      // 기준 랙
let activeLineEdit = null; // { group, index, isClosed }
let previewZoom = 1.0;
let previewCameraAngle = 0;
let isDraggingPreview = false;
let lastPreviewX = 0;
let _dragFrameScheduled = false;
const rackPools = {};
const palletPools = {};
const MAX_RACKS = 20000;
const MAX_PALLETS = 5000;
let multiSelectEdge = null;
let isSelected = [];

// 카메라 잠금 상태 백업
let _savedOrbitState = null;
let _lineDragWheelBlocker = null;

// 코너 픽셀 임계
const CORNER_PICK_PX = 12;

// 마우스와 광선 투사 설정
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const intersectPoint = new THREE.Vector3();

// OrbitControls 설정
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.15;
orbitControls.rotateSpeed = 0.4;
orbitControls.zoomSpeed = 1.2;
orbitControls.panSpeed = 1.0;
orbitControls.minDistance = 300;
orbitControls.maxDistance = 10000;
orbitControls.minPolarAngle = 0;              // 위로 제한 없음
orbitControls.maxPolarAngle = Math.PI / 2.05; // 바닥 아래로 안 내려감

orbitControls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN
};

// 미리보기 캔버스 및 렌더러
const previewCanvas = document.getElementById('preview-canvas');
const previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, alpha: true });
previewRenderer.setSize(previewCanvas.width, previewCanvas.height);
previewRenderer.setPixelRatio(window.devicePixelRatio);

// 미리보기 전용 scene, camera, light
const previewScene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(45, previewCanvas.width / previewCanvas.height, 1, 3000);
previewCamera.up.set(0, 1, 0);
previewCamera.position.set(5, 100, 250);
previewCamera.lookAt(0, 150, 0);
const previewLight = new THREE.DirectionalLight(0xffffff, 1);
previewLight.position.set(100, 200, 100);
previewScene.add(previewLight);

// 바닥 그리드 선
for (let x = -gridWidth / 2; x <= gridWidth / 2; x += cellW) {
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, 0.1, -gridDepth / 2),
    new THREE.Vector3(x, 0.1, gridDepth / 2)
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(lineGeo, lineMat);
  gridHelper.add(line);
}

for (let z = -gridDepth / 2; z <= gridDepth / 2; z += cellD) {
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-gridWidth / 2, 0.1, z),
    new THREE.Vector3(gridWidth / 2, 0.1, z)
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(lineGeo, lineMat);
  gridHelper.add(line);
}

scene.add(gridHelper);
gridHelper.position.y = -10; // 그리드 높이

// 바닥 및 그리드 크기 조절
function updateGridAndFloorXY(newW, newD, expandDir = { x: 1, z: 1 }) {
  const deltaW = newW - gridWidth;
  const deltaD = newD - gridDepth;
  const margin = cellW - 0.7;

  // 현재 바닥 영역 계산
  const currentMinX = floorOffsetX - gridWidth / 2;
  const currentMaxX = floorOffsetX + gridWidth / 2;
  const currentMinZ = floorOffsetZ - gridDepth / 2;
  const currentMaxZ = floorOffsetZ + gridDepth / 2;
  const currentMinY = -Infinity;
  const currentMaxY = Infinity;

  const tryingToShrinkX = deltaW < 0;
  const tryingToShrinkZ = deltaD < 0;

  // 방향별 shrink 영역 계산 함수
  function getShrinkBoxes() {
    const shrinkBoxes = [];

    // 왼쪽 축소 (expandDir.x === 1)
    if (tryingToShrinkX && expandDir.x === 1) {
      shrinkBoxes.push(new THREE.Box3(
        new THREE.Vector3(currentMinX, currentMinY, currentMinZ),
        new THREE.Vector3(currentMinX + Math.abs(deltaW), currentMaxY, currentMaxZ)
      ));
    }

    // 오른쪽 축소 (expandDir.x === -1)
    if (tryingToShrinkX && expandDir.x === -1) {
      shrinkBoxes.push(new THREE.Box3(
        new THREE.Vector3(currentMaxX - Math.abs(deltaW), currentMinY, currentMinZ),
        new THREE.Vector3(currentMaxX, currentMaxY, currentMaxZ)
      ));
    }

    // 위쪽 축소 (expandDir.z === -1)
    if (tryingToShrinkZ && expandDir.z === -1) {
      shrinkBoxes.push(new THREE.Box3(
        new THREE.Vector3(currentMinX, currentMinY, currentMaxZ - Math.abs(deltaD)),
        new THREE.Vector3(currentMaxX, currentMaxY, currentMaxZ)
      ));
    }

    // 아래쪽 축소 (expandDir.z === 1)
    if (tryingToShrinkZ && expandDir.z === 1) {
      shrinkBoxes.push(new THREE.Box3(
        new THREE.Vector3(currentMinX, currentMinY, currentMinZ),
        new THREE.Vector3(currentMaxX, currentMaxY, currentMinZ + Math.abs(deltaD))
      ));
    }
    return shrinkBoxes;
  }

  // 축소 영역 충돌 검사
  const shrinkAreas = getShrinkBoxes();
  for (const area of shrinkAreas) {
    // 랙 충돌
    for (const rack of rackGroups) {
      const rackBox = new THREE.Box3().setFromObject(rack);
      rackBox.expandByScalar(-margin);
      if (rackBox.intersectsBox(area)) {
        alert("해당 방향에 랙이 있어 축소할 수 없습니다.");
        return;
      }
    }

    // 영역선 충돌
    for (const line of markingLines) {
      const lineBox = new THREE.Box3().setFromObject(line);
      if (lineBox.intersectsBox(area)) {
        alert("해당 방향에 영역선이 있어 축소할 수 없습니다.");
        return;
      }
    }
  }


  // offset 누적
  if (expandDir.x === 1) floorOffsetX -= deltaW / 2;
  else if (expandDir.x === -1) floorOffsetX += deltaW / 2;
  if (expandDir.z === 1) floorOffsetZ -= deltaD / 2;
  else if (expandDir.z === -1) floorOffsetZ += deltaD / 2;

  // 새 사이즈 저장
  gridWidth = newW;
  gridDepth = newD;

  // 바닥 다시 생성
  if (floorMesh) scene.remove(floorMesh);
  const floorGeo = new THREE.PlaneGeometry(newW, newD);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xddeeff, metalness: 0.05, roughness: 0.7 });
  floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorMesh.position.set(floorOffsetX, -30, floorOffsetZ);
  scene.add(floorMesh);


  // 그리드 병합하여 다시 그림
  gridHelper.clear();
  const MAX_GRID_LINES = 200;
  const stepX = Math.max(cellW, newW / MAX_GRID_LINES);
  const stepZ = Math.max(cellD, newD / MAX_GRID_LINES);
  const geos = [];

  for (let x = -newW / 2; x <= newW / 2; x += stepX) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.1, -newD / 2),
      new THREE.Vector3(x, 0.1, newD / 2)
    ]);
    geos.push(geo);
  }

  for (let z = -newD / 2; z <= newD / 2; z += stepZ) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-newW / 2, 0.1, z),
      new THREE.Vector3(newW / 2, 0.1, z)
    ]);
    geos.push(geo);
  }

  const merged = BufferGeometryUtils.mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  const line = new THREE.LineSegments(
    merged,
    new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.5 })
  );
  gridHelper.add(line);
  gridHelper.position.set(floorOffsetX, -20, floorOffsetZ);

}

updateGridAndFloorXY(gridWidth, gridDepth);
gridHelper.visible = false; // 최초 실행

// 랙 생성(x,y,cols,floors 기초값)
function createRealisticShelf(
  x = 0, z = 0, cols = 4, floors = 4,
  depthOverride = null, cellWOverride = null, addToScene = true
) {
  const group = new THREE.Group();
  const localCellW = cellWOverride ?? cellW;
  const width = cols * localCellW;
  const height = floors * cellH;
  const depthUnits = depthOverride !== null ? Math.round(depthOverride / cellD) : 1;
  const depth = depthUnits * cellD;
  const depthSlots = depthUnits;
  const shelfYOffset = 20;

  group.userData = {
    type: 'rack', cols, floors, width, depth, depthUnits, depthSlots,
    cellW: localCellW, slots: []
  };
  group.position.set(x, 0, z);

  // 파트 모으기
  const parts = [];

  // 기둥
  const legGeomBase = new THREE.CylinderGeometry(4, 4, height, 16);

  for (let ci = 0; ci <= cols; ci++) {
    const xOffset = -width / 2 + ci * localCellW;
    for (let dj = 0; dj <= depthSlots; dj++) {
      const zOffset = -depth / 2 + dj * cellD;

      let g;

      // 모서리 기둥이면 height + extra
      const isEdgeX = (ci === 0 || ci === cols);
      const isEdgeZ = (dj === 0 || dj === depthSlots);
      if (isEdgeX && isEdgeZ) {
        const extra = 20; // 바닥까지 내려가는 보정값 (shelfYOffset에 맞춤)
        g = new THREE.CylinderGeometry(4, 4, height + extra, 16);
        g.translate(xOffset, (height + extra) / 2 - extra, zOffset);
      } else {
        // 일반 기둥은 기존 legGeomBase 사용
        g = legGeomBase.clone();
        g.translate(xOffset, height / 2, zOffset);
      }

      // 색상 지정
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < g.attributes.position.count; i++) {
        colors[i * 3 + 0] = 0.0; // R
        colors[i * 3 + 1] = 0.3; // G
        colors[i * 3 + 2] = 1.0; // B
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    }
  }

  // 선반
  for (let f = 0; f <= floors; f++) {
    const g = new THREE.BoxGeometry(width, 2, depth);
    g.translate(0, f * cellH + 1, 0);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      colors.set([1.4, 1.4, 1.4], i * 3); // 흰색
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }

  // 노란 테두리
  const railThickness = 4, railHeight = 2, railYOffset = 3;
  for (let f = 0; f <= floors; f++) {
    const shelfPosY = f * cellH + 1;
    const yellowBoxes = [
      new THREE.BoxGeometry(width, railHeight, railThickness).translate(0, shelfPosY + railYOffset, -depth / 2 + railThickness / 2),
      new THREE.BoxGeometry(width, railHeight, railThickness).translate(0, shelfPosY + railYOffset, depth / 2 - railThickness / 2),
      new THREE.BoxGeometry(railThickness, railHeight, depth).translate(-width / 2 + railThickness / 2, shelfPosY + railYOffset, 0),
      new THREE.BoxGeometry(railThickness, railHeight, depth).translate(width / 2 - railThickness / 2, shelfPosY + railYOffset, 0),
    ];
    yellowBoxes.forEach(g => {
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < g.attributes.position.count; i++) {
        colors.set([3.0, 2.0, 1], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    });
  }

  // 회색 그리드 (최상단만, 가로/세로 둘 다)
  const shelfPosY = floors * cellH + 1;
  const colsX = Math.floor(width / 100);
  const rowsZ = Math.floor(depth / 100);

  for (let c = 1; c < colsX; c++) {
    const g = new THREE.BoxGeometry(railThickness, railHeight, depth - railThickness * 2);
    g.translate(-width / 2 + c * 100, shelfPosY + railYOffset + 1, 0);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      colors.set([0.5, 0.56, 1], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }

  for (let r = 1; r < rowsZ; r++) {
    const g = new THREE.BoxGeometry(width - railThickness * 2, railHeight, railThickness);
    g.translate(0, shelfPosY + railYOffset + 1, -depth / 2 + r * 100);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      colors.set([0.5, 0.56, 1], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }

  // merge (안전 필터링)
  const validParts = parts.filter(p => p && p.isBufferGeometry);
  const merged = BufferGeometryUtils.mergeGeometries(validParts, true);

  // Instancing or 단일 Mesh
  if (!addToScene) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(merged, mat);
    group.add(mesh);
    return group;
  }

  // 조합별 풀 가져오기
  const key = `${cols}x${floors}x${depthSlots}`;
  if (!rackPools[key]) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const pool = new THREE.InstancedMesh(merged, mat, MAX_RACKS);
    pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pool.count = 0;
    pool.frustumCulled = false;
    scene.add(pool);
    rackPools[key] = pool;
  }
  const pool = rackPools[key];

  // 인스턴스 추가
  const idx = pool.count++;
  const mat4 = new THREE.Matrix4().compose(
    group.position.clone(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
    new THREE.Vector3(1, 1, 1)
  );
  pool.setMatrixAt(idx, mat4);
  pool.instanceMatrix.needsUpdate = true;

  group.userData.index = idx;
  group.userData.poolKey = key;

  // 슬롯 등록
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      for (let d = 0; d < depthSlots; d++) {
        const sx = -cols * localCellW / 2 + (c + 0.5) * localCellW;
        const sy = f * cellH + cellH * 0.35;
        const sz = -depthSlots * cellD / 2 + (d + 0.5) * cellD;

        const pos = new THREE.Vector3(sx, sy, sz);
        group.userData.slots.push({
          floor: f,
          col: c,
          depthIndex: d,
          occupied: false,
          worldPosition: pos
        });
      }
    }
  }

  // Edge (드래그 핸들)
  const edgeWidth = width;
  const edgeHeight = height + shelfYOffset + 13;
  const edgeDepth = depth;
  const edgeGeometry = new THREE.BoxGeometry(edgeWidth + 10, edgeHeight + 10, edgeDepth + 10);
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });
  const edge = new THREE.Mesh(edgeGeometry, edgeMat);
  const edgeCenterY = (edgeHeight / 2) - shelfYOffset;
  edge.position.set(0, edgeCenterY, 0);
  edge.userData.localCenter = edge.position.clone();
  edge.updateMatrix();
  edge.matrixAutoUpdate = false;
  edge.userData.group = group;
  edge.visible = false;
  edge.name = 'edge';
  group.userData.edge = edge;
  group.add(edge);

  if (addToScene) {
    scene.add(group);
  }
  return group;
}

// 파레트 생성
function createPalletRack(
  x = 0, z = 0, cols = 2, depthSlots = 2, addToScene = true
) {
  cols = Math.max(1, Math.round(cols));
  depthSlots = Math.max(1, Math.round(depthSlots));

  const group = new THREE.Group();
  const width = cols * cellW;
  const depth = depthSlots * cellD;
  const height = cellH / 2;

  group.userData = {
    type: 'pallet',
    cols,
    floors: 1,
    width,
    depth,
    cellW,
    depthSlots,
    slots: []
  };
  group.position.set(x, 0, z);

  // 파트 모으기
  const parts = [];

  // 다리
  const legGeom = new THREE.CylinderGeometry(4, 4, height, 10);
  for (let i = 0; i <= cols; i++) {
    const xOffset = -width / 2 + i * (width / cols);
    for (let j = 0; j <= depthSlots; j++) {
      const zOffset = -depth / 2 + j * (depth / depthSlots);
      const g = legGeom.clone();
      g.translate(xOffset, height / 2 - 20, zOffset);

      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < g.attributes.position.count; k++) {
        colors.set([0, 0, 1.0], k * 3); // 파란색
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      parts.push(g);
    }
  }

  // 상판 2개
  const shelfGeom1 = new THREE.BoxGeometry(width, 2, depth);
  shelfGeom1.translate(0, -18, 0);
  {
    const colors = new Float32Array(shelfGeom1.attributes.position.count * 3);
    for (let i = 0; i < shelfGeom1.attributes.position.count; i++) {
      colors.set([0, 0, 1.0], i * 3);
    }
    shelfGeom1.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  parts.push(shelfGeom1);

  const shelfGeom2 = new THREE.BoxGeometry(width, 2, depth);
  shelfGeom2.translate(0, cellH - 48, 0);
  {
    const colors = new Float32Array(shelfGeom2.attributes.position.count * 3);
    for (let i = 0; i < shelfGeom2.attributes.position.count; i++) {
      colors.set([0, 0, 1.0], i * 3);
    }
    shelfGeom2.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  parts.push(shelfGeom2);

  // === 노란 테두리 (맨 위만) ===
  const railThickness = 1, railHeight = 2, railYOffset = -16;
  const topY = height; // 파레트 맨 윗판 높이 기준
  const yellowBoxes = [
    new THREE.BoxGeometry(width, railHeight, railThickness)
      .translate(0, topY + railYOffset, -depth / 2 + railThickness / 2),
    new THREE.BoxGeometry(width, railHeight, railThickness)
      .translate(0, topY + railYOffset, depth / 2 - railThickness / 2),
    new THREE.BoxGeometry(railThickness, railHeight, depth)
      .translate(-width / 2 + railThickness / 2, topY + railYOffset, 0),
    new THREE.BoxGeometry(railThickness, railHeight, depth)
      .translate(width / 2 - railThickness / 2, topY + railYOffset, 0),
  ];

  yellowBoxes.forEach(g => {
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      colors.set([0, 0, 0], i * 3); // 노란색
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  });

  // merge
  const validParts = parts.filter(p => p && p.isBufferGeometry);
  const merged = BufferGeometryUtils.mergeGeometries(validParts, true);

  // Instancing or 단일 Mesh
  if (!addToScene) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(merged, mat);
    group.add(mesh);
    return group;
  }

  // 조합별 풀 가져오기
  const key = `${cols}x${depthSlots}`;
  if (!palletPools[key]) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const pool = new THREE.InstancedMesh(merged, mat, MAX_PALLETS);
    pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pool.count = 0;
    pool.frustumCulled = false;
    scene.add(pool);
    palletPools[key] = pool;
  }
  const pool = palletPools[key];

  // 인스턴스 추가
  const idx = pool.count++;
  const mat4 = new THREE.Matrix4().compose(
    group.position.clone(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
    new THREE.Vector3(1, 1, 1)
  );
  pool.setMatrixAt(idx, mat4);
  pool.instanceMatrix.needsUpdate = true;

  group.userData.index = idx;
  group.userData.poolKey = key;

  // 슬롯 하나만
  group.userData.slots.push({
    floor: 1,
    col: Math.floor(cols / 2),
    depthIndex: Math.floor(depthSlots / 2),
    occupied: false,
    worldPosition: new THREE.Vector3(0, cellH - 20, 0)
  });

  // Edge (드래그 핸들)
  const edgeWidth = width;
  const edgeHeight = height + 10;
  const edgeDepth = depth;
  const edgeGeometry = new THREE.BoxGeometry(edgeWidth + 10, edgeHeight + 10, edgeDepth + 10);
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });
  const edge = new THREE.Mesh(edgeGeometry, edgeMat);
  edge.position.set(0, 0, 0);
  edge.userData.localCenter = edge.position.clone();
  edge.updateMatrix();
  edge.matrixAutoUpdate = false;
  edge.userData.group = group;
  edge.visible = false;
  edge.name = "edge";
  group.userData.edge = edge;
  group.add(edge);

  if (addToScene) {
    scene.add(group);
  }
  return group;
}


// 랙 안의 박스 추가
function addBoxToFirstEmptySlot(group) {
  const rackCellW = group.userData.cellW || cellW;

  let availableSlots = [];
  if (group.userData.type === "rack") {
    availableSlots = group.userData.slots.filter(s => !s.occupied);
  } else if (group.userData.type === "pallet") {
    availableSlots = group.userData.slots.filter(s => !s.occupied && s.floor === 1);
  }

  if (!availableSlots || availableSlots.length === 0) {
    alert("더 이상 박스를 추가할 수 없습니다 (슬롯이 모두 찼어요)");
    return;
  }

  // 슬롯 정렬
  availableSlots.sort((a, b) =>
    a.floor - b.floor || a.col - b.col || a.depthIndex - b.depthIndex
  );
  const slot = availableSlots[0];

  // 처음 박스 InstancedMesh 생성
  if (!group.userData.boxMesh) {
    let boxW, boxH, boxD;

    if (group.userData.type === "pallet") {
      const palletW = group.userData.width;
      const palletD = group.userData.depth;

      const baseW = 2 * cellW;
      const baseD = 2 * cellD;
      const scaleW = palletW / baseW;
      const scaleD = palletD / baseD;
      const scale = Math.min(scaleW, scaleD);

      boxW = palletW * 0.8;
      boxD = palletD * 0.8;
      boxH = cellH * 0.9 * scale;
    } else {
      boxW = rackCellW * 0.8;
      boxH = cellH * 0.7;
      boxD = cellD * 0.9;
    }

    const boxGeo = new THREE.BoxGeometry(boxW, boxH, boxD);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xff6d6d });
    const instanced = new THREE.InstancedMesh(boxGeo, boxMat, 1000);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 인스턴스 색상 활성화
    instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1000 * 3), 3);
    const defaultColor = new THREE.Color(0xc06d6d);
    for (let i = 0; i < 1000; i++) {
      instanced.setColorAt(i, defaultColor);
    }

    instanced.count = 0;
    group.userData.boxMesh = instanced;
    group.userData.boxCount = 0;
    group.add(instanced);
  }

  const mesh = group.userData.boxMesh;
  const index = group.userData.boxCount;

  // 슬롯 좌표
  const pos = slot.worldPosition.clone();
  if (group.userData.type === "pallet") {
    const boxH = mesh.geometry.parameters.height;
    pos.y += boxH / 2 - 20;
  }

  const mat = new THREE.Matrix4();
  mat.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  mesh.setMatrixAt(index, mat);

  // 항상 기본색으로 초기화
  mesh.setColorAt(index, new THREE.Color(0xc06d6d));

  mesh.count = index + 1;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;

  slot.occupied = true;
  slot.instanceIndex = index;

  group.userData.boxCount++;
}

function deleteSelectedRack() {
  if (!isEditMode) {
    alert('읽기 전용 모드에서는 삭제할 수 없습니다.');
    return;
  }

  // multiSelectEdge 활성화 시, 항상 selectedRackGroups를 갱신
  if (selectedRackGroups.length === 0 && multiSelectEdge?.visible) {
    const edgeBox = new THREE.Box3().setFromObject(multiSelectEdge);
    selectedRackGroups = rackGroups.filter(g => {
      const box = getAccurateRackBoundingBox(g);
      return edgeBox.intersectsBox(box);
    });
  }

  // 삭제 대상 모으기
  let targets = selectedRackGroups.length > 0
    ? [...selectedRackGroups]
    : (selectedGroup ? [selectedGroup] : []);

  if (targets.length === 0) return;

  // 삭제 실행
  targets.forEach(group => {
    if (!group) return;

    if (group.userData.type === 'rack') {
      removeRackInstance(group);
    } else if (group.userData.type === 'pallet') {
      removePalletInstance(group);
    }

    scene.remove(group);
    safeRemoveEdge(group.userData?.edge);
    disposeObject(group);

    const idx = rackGroups.indexOf(group);
    if (idx !== -1) rackGroups.splice(idx, 1);

    const edge = group.userData.edge;
    if (edge) {
      const i = dragHandles.indexOf(edge);
      if (i !== -1) dragHandles.splice(i, 1);
    }
    if (dragControls) {
      const objs = dragControls.getObjects();
      const i = objs.indexOf(edge);
      if (i !== -1) objs.splice(i, 1);
    }
  });

  // 선택 해제
  selectedRackGroups = [];
  selectedGroup = null;
  gridHelper.visible = false;

  updateFloatingStacks();
  updateMultiSelectEdge();
}


// 인스턴스 풀 삭제
function removeRackInstance(group) {
  if (!group || !group.userData) return;
  const key = group.userData.poolKey;
  const pool = rackPools[key];
  if (!pool) return;

  const idx = group.userData.index;
  const last = pool.count - 1;

  if (idx < 0 || idx >= pool.count) return;

  if (idx !== last) {
    // 마지막 인스턴스를 현재 자리로 옮김
    const mat = new THREE.Matrix4();
    pool.getMatrixAt(last, mat);
    pool.setMatrixAt(idx, mat);

    // 교체된 그룹의 index도 갱신
    const swapped = rackGroups.find(
      g => g.userData.poolKey === key && g.userData.index === last
    );
    if (swapped) swapped.userData.index = idx;
  }

  pool.count--;
  pool.instanceMatrix.needsUpdate = true;
}

// 파레트 풀 삭제
function removePalletInstance(group) {
  if (!group || !group.userData.poolKey) return;
  const key = group.userData.poolKey;
  const pool = palletPools[key];
  if (!pool) return;

  const idx = group.userData.index;
  const last = pool.count - 1;

  if (idx < 0 || idx >= pool.count) return;

  if (idx !== last) {
    const mat = new THREE.Matrix4();
    pool.getMatrixAt(last, mat);
    pool.setMatrixAt(idx, mat);

    // 스왑된 그룹의 인덱스 갱신 (파레트만 찾도록 보장)
    const swapped = rackGroups.find(
      g => g.userData.type === 'pallet' &&
        g.userData.poolKey === key &&
        g.userData.index === last
    );
    if (swapped) swapped.userData.index = idx;
  }

  pool.count--;
  pool.instanceMatrix.needsUpdate = true;
}


// 영역선 생성
function createThickMarkingLine(pointsOrStart, endMaybe, color = 0xffcc00, width = 30) {
  if (Array.isArray(pointsOrStart) && typeof endMaybe === 'number') {
    width = (typeof color === 'number') ? color : width;
    color = endMaybe;
  }

  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const Y = 2;
  const R = width / 2;
  const EPS = 1e-6;

  // 입력 포인트
  const ptsRaw = Array.isArray(pointsOrStart) ? pointsOrStart.slice() : [pointsOrStart, endMaybe];

  // 첫점≈끝점이면 마지막 점 제거로 합치기
  const sameXZ = (p, q) => Math.abs(p.x - q.x) < EPS && Math.abs(p.z - q.z) < EPS;
  const closed = ptsRaw.length >= 2 && sameXZ(ptsRaw[0], ptsRaw[ptsRaw.length - 1]);
  const pts = closed ? ptsRaw.slice(0, -1) : ptsRaw;
  if (pts.length < 2) return group;

  // 세그먼트 기록과 중복 방지
  const segments = [];
  const segKeys = new Set();
  const toXZ = (p) => new THREE.Vector3(p.x, Y, p.z);
  const keyOf = (ai, bi) => {
    const a = Math.min(ai, bi);
    const b = Math.max(ai, bi);
    return `${a}-${b}`;
  };

  const addSeg = (a, b, ai, bi) => {
    const s = toXZ(a), e = toXZ(b);
    const dir = e.clone().sub(s);
    const len = dir.length();
    if (len < EPS) {
      if (!activeLineEdit) {
        return; // 드래그 중이 아닐 때만 무시
      }
    }

    const k = keyOf(ai, bi);
    if (segKeys.has(k)) return;
    segKeys.add(k);

    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), mat);
    m.position.set((s.x + e.x) / 2, Y, (s.z + e.z) / 2);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(dir.z, dir.x); // 생성/업데이트 축 일치
    group.add(m);

    segments.push({ a: ai, b: bi, mesh: m });
  };

  // 끝면/코너 표시
  const addCap = (center, dir, isStart) => {
    const angle = Math.atan2(dir.z, dir.x);
    const geo = new THREE.CircleGeometry(R, 32, isStart ? Math.PI / 2 : -Math.PI / 2, Math.PI);
    const m = new THREE.Mesh(geo, mat);
    const c = toXZ(center);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -angle;
    m.position.set(c.x, c.y, c.z);
    group.add(m);
  };
  const addJoint = (center) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32), mat);
    const c = toXZ(center);
    m.rotation.x = -Math.PI / 2;
    m.position.set(c.x, c.y, c.z);
    m.visible = true;
    group.add(m);
  };

  // 세그먼트 생성: 단일 루프
  for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i], pts[i + 1], i, i + 1);
  // 닫힘이면 마지막→첫점 1회만
  if (pts.length >= 3 && closed) addSeg(pts[pts.length - 1], pts[0], pts.length - 1, 0);

  // 캡/조인트: 닫힘이면 조인트만, 열린이면 캡+조인트
  if (pts.length >= 2) {
    const d0 = pts[1].clone().sub(pts[0]);
    const d1 = pts[pts.length - 1].clone().sub(pts[pts.length - 2]);

    if (closed) {
      for (let i = 0; i < pts.length; i++) addJoint(pts[i]);
    } else {
      addCap(pts[0], d0, true);
      for (let i = 1; i < pts.length - 1; i++) addJoint(pts[i]);
      addCap(pts[pts.length - 1], d1, false);
    }
  }

  group.userData = {
    type: 'markingLine',
    width,
    thickness: width,
    color,
    points: pts.map(p => p.clone()),
    segments
  };
  return group;
}

// 코너 드래그 중, 해당 코너에 붙은 세그먼트 2개만 즉시 갱신
function updateSegMesh(group, a, b, thickness) {
  if (!group?.userData?.segments) return;

  const seg = group.userData.segments.find(s =>
    (s.a === a && s.b === b) || (s.a === b && s.b === a)
  );
  if (!seg || !seg.mesh) return;

  const A = group.userData.points[a];
  const B = group.userData.points[b];
  const dir = new THREE.Vector3().subVectors(B, A);
  const len = dir.length();
  if (len < 1e-6) return;

  const center = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
  const angle = Math.atan2(dir.z, dir.x);

  // 생성 로직과 동일한 회전축을 사용해야 함
  seg.mesh.position.set(center.x, center.y, center.z);
  seg.mesh.rotation.x = -Math.PI / 2;
  seg.mesh.rotation.z = -angle;

  // 간단하게 지오메트리 교체 (두 세그먼트만 갱신하므로 부담 적음)
  const old = seg.mesh.geometry;
  if (Math.abs(old.parameters.width - len) > 0.1 || Math.abs(old.parameters.height - thickness) > 0.1) {
    seg.mesh.geometry.dispose();
    seg.mesh.geometry = new THREE.PlaneGeometry(len, thickness);
  }
  if (old) old.dispose();
}

// 영역끝선 가까우면 드래그 처리
function worldToScreenPx(worldVec3) {
  const v = worldVec3.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    (v.x * 0.5 + 0.5) * rect.width,
    (-v.y * 0.5 + 0.5) * rect.height
  );
}

function updateSelectionBox(x, y) {
  const sx = Math.min(x, selectionStart.x);
  const sy = Math.min(y, selectionStart.y);
  const ex = Math.max(x, selectionStart.x);
  const ey = Math.max(y, selectionStart.y);
  selectionBox.style.left = `${sx}px`;
  selectionBox.style.top = `${sy}px`;
  selectionBox.style.width = `${ex - sx}px`;
  selectionBox.style.height = `${ey - sy}px`;
}

//미리보기 창에 따로 들어가는 랙, 파레트 이미지
function renderMiniPreview(mode) {
  const cols = parseInt(document.getElementById('rack-cols').value || '4');
  const floors = parseInt(document.getElementById('rack-floors').value || '4');
  const depthUnits = parseInt(document.getElementById('rack-depth').value || '1');
  const cellWUnits = parseInt(document.getElementById('rack-cellw').value || '1');

  const depth = depthUnits * cellD;
  const cellW = cellWUnits * 100;

  let previewForCanvas;
  if (mode === 'rack') {
    previewForCanvas = createRealisticShelf(0, 0, cols, floors, depth, cellW, false);
  } else if (mode === 'pallet') {
    previewForCanvas = createPalletRack(0, 0, 2, 2, false);
    previewForCanvas.position.y += 80;
  }

  if (!previewForCanvas) return;

  previewForCanvas.traverse(obj => {
    if (obj.isMesh && obj.material?.clone) {
      obj.material = obj.material.clone();
      obj.material.transparent = false;
      obj.material.opacity = 1;
    }
  });

  // 카메라 위치 조절
  previewCamera.position.set(
    5 * previewZoom,
    (100 + floors * 50) * previewZoom,
    (250 + depth * 0.6 + 100) * previewZoom
  );

  const radius = (250 + depth * 0.6 + 100) * previewZoom;
  previewCamera.position.set(
    radius * Math.sin(previewCameraAngle),
    (100 + floors * 50) * previewZoom,
    radius * Math.cos(previewCameraAngle)
  );
  previewCamera.lookAt(0, 70 + floors * 20, 0);
  previewScene.clear();
  previewScene.add(previewLight);
  previewScene.add(previewForCanvas);
}

function findStackTargetAndY(candidate, options = {}) {
  const gap = 12;
  const candBox = getAccurateRackBoundingBox(candidate);
  let bestTarget = null;
  let bestTopY = -Infinity;

  // 파레트는 위로 쌓는 대상이 아님
  if (candidate.userData?.type === 'pallet') {
    return { ok: false };
  }

  // 후보 탐색
  for (const g of rackGroups) {
    if (!g || g === candidate) continue;
    if (g.userData && g.userData._excludeAsStackTarget) continue;

    // 상대 박스 박스 계산 (회전 반영)
    const boxB = getAccurateRackBoundingBox(g);

    // 빠른 거리 컷: 중심/폭 기준으로 멀면 스킵
    const cx = (candBox.min.x + candBox.max.x) * 0.5;
    const cz = (candBox.min.z + candBox.max.z) * 0.5;
    const bx = (boxB.min.x + boxB.max.x) * 0.5;
    const bz = (boxB.min.z + boxB.max.z) * 0.5;

    const allowX = ((candBox.max.x - candBox.min.x) + (boxB.max.x - boxB.min.x)) * 0.5 + 0.5 * cellW;
    const allowZ = ((candBox.max.z - candBox.min.z) + (boxB.max.z - boxB.min.z)) * 0.5 + 0.5 * cellD;

    if (Math.abs(cx - bx) > allowX) continue;
    if (Math.abs(cz - bz) > allowZ) continue;

    // 겹침 비율 계산 (후보 좁히기)
    const xOverlap = Math.max(0, Math.min(candBox.max.x, boxB.max.x) - Math.max(candBox.min.x, boxB.min.x));
    const zOverlap = Math.max(0, Math.min(candBox.max.z, boxB.max.z) - Math.max(candBox.min.z, boxB.min.z));
    const overlapArea = xOverlap * zOverlap;

    const candidateArea = (candBox.max.x - candBox.min.x) * (candBox.max.z - candBox.min.z);
    if (candidateArea <= 0) continue; // 안전 가드

    const overlapRatio = overlapArea / candidateArea;
    if (overlapRatio < 0.5) continue; // 50% 이상만 후보

    // 가장 높은 꼭대기를 가진 타겟 선택
    if (boxB.max.y > bestTopY) {
      bestTopY = boxB.max.y;
      bestTarget = g;
    }
  }

  if (!bestTarget) return { ok: false };

  // 규격/회전 파리티 일치 확인
  const matchCols = (candidate.userData.width === bestTarget.userData.width);
  const matchDepth = (candidate.userData.depth === bestTarget.userData.depth);

  const rotA = Math.round((candidate.rotation.y % (2 * Math.PI)) / (Math.PI / 2)) % 4;
  const rotB = Math.round((bestTarget.rotation.y % (2 * Math.PI)) / (Math.PI / 2)) % 4;
  const matchRot = (rotA % 2 === rotB % 2);

  if (!(matchCols && matchDepth && matchRot)) {
    // 규격이나 회전이 맞지 않으면 타겟은 알려주되 ok=false
    return { ok: false, target: bestTarget };
  }

  // 짝수/홀수 깊이 보정(half-cell) + gap
  const thisEven = Math.floor((candidate.userData.depth ?? cellD) / cellD) % 2 === 0;
  const belowEven = Math.floor((bestTarget.userData.depth ?? cellD) / cellD) % 2 === 0;
  const evenAdjust = (belowEven ? -cellH / 2 : 0) + (thisEven ? cellH / 2 : 0);

  const y = bestTopY + gap + evenAdjust;

  return { ok: true, target: bestTarget, y };
}


// 생성 버튼 눌렀을 때 사용하는 함수: 마우스를 따라다니는 previewRack만 생성
function showPreview(mode) {
  if (!isEditMode) return;
  removePreviewRack();

  const cols = parseInt(document.getElementById('rack-cols').value || '4');
  const floors = parseInt(document.getElementById('rack-floors').value || '4');
  const depthUnits = parseInt(document.getElementById('rack-depth').value || '1');
  const cellWUnits = parseInt(document.getElementById('rack-cellw').value || '1');

  const depth = depthUnits * cellD;
  const cellW = cellWUnits * 100;

  let preview;
  if (mode === 'rack') {
    preview = createRealisticShelf(0, 0, cols, floors, depth, cellW, false);
  } else if (mode === 'pallet') {
    preview = createPalletRack(0, 0, 2, 2, false);
  }

  if (!preview) return;

  preview.traverse(obj => {
    if (obj.isMesh && obj.material?.clone) {
      obj.material = obj.material.clone();
      obj.material.transparent = true;
      obj.material.opacity = 0.3;
    }
  });

  previewRack = preview;
  currentPreviewMode = mode;
}

document.addEventListener('keydown', e => currentPreviewMode && previewRack && (e.key === 'r' || e.key === 'R') && (previewRack.rotation.y += Math.PI / 2));


//미리보기 제거 함수
function removePreviewRack() {
  if (previewRack) {
    scene.remove(previewRack);
    safeRemoveEdge(previewRack.userData?.edge);
    disposeObject(previewRack);
    previewRack = null;
  }
}

// 그리드에 맞춰 드랍시키기 위한 클램프
function clampToGridBoundsUnified(x, z, offsetX = 0, offsetZ = 0) {
  const correctedOffsetX = offsetX;
  const correctedOffsetZ = offsetZ;

  // 바닥 offset이 짝수 셀이면 반칸 보정 제거
  const gridEvenX = Math.floor(gridWidth / cellW) % 2 === 0;
  const gridEvenZ = Math.floor(gridDepth / cellD) % 2 === 0;

  const extraX = gridEvenX ? cellW / 2 : 0;
  const extraZ = gridEvenZ ? cellD / 2 : 0;

  const snappedX = Math.round((x - floorOffsetX - correctedOffsetX - extraX) / cellW) * cellW
    + floorOffsetX + correctedOffsetX + extraX;

  const snappedZ = Math.round((z - floorOffsetZ - correctedOffsetZ - extraZ) / cellD) * cellD
    + floorOffsetZ + correctedOffsetZ + extraZ;

  return { x: snappedX, z: snappedZ };
}
// 회전된 랙 따로 계산
function getOffsetFromGroup(group) {
  const rotY = group.rotation.y % (2 * Math.PI);
  const rotStep = Math.round(rotY / (Math.PI / 2)) % 4;
  const isRotated = rotStep % 2 === 1;

  const w = isRotated ? group.userData.depth : group.userData.width;
  const d = isRotated ? group.userData.width : group.userData.depth;

  const isEvenW = Math.floor(w / cellW) % 2 === 0;
  const isEvenD = Math.floor(d / cellD) % 2 === 0;

  const offsetX = isEvenW ? -cellW / 2 : 0;
  const offsetZ = isEvenD ? -cellD / 2 : 0;

  return { offsetX, offsetZ };
}

// dragHandle 확실하게 지우기 위한 함수
function safeRemoveEdge(edge) {
  if (!edge || !edge.matrixWorld) return;

  // 씬과 그룹에서 제거
  if (edge.parent) edge.parent.remove(edge);
  if (scene.children.includes(edge)) scene.remove(edge);

  // 드래그 핸들 목록에서 제거
  const idx = dragHandles.indexOf(edge);
  if (idx !== -1) dragHandles.splice(idx, 1);

  // DragControls에서도 제거
  if (dragControls) {
    const objs = dragControls.getObjects();
    const i = objs.indexOf(edge);
    if (i !== -1) objs.splice(i, 1);
  }
}

// 랙 끼리 겹침 판정
function isTooMuchOverlap(group, exclude = null) {
  const boxA = getAccurateRackBoundingBox(group);
  const sizeA = new THREE.Vector3();
  boxA.getSize(sizeA);

  return rackGroups.some(other => {
    if (!other || other === group) return false;
    if (exclude instanceof Set && exclude.has(other)) return false;
    if (Array.isArray(exclude) && exclude.includes(other)) return false;
    if (other === exclude) return false;

    const boxB = getAccurateRackBoundingBox(other);
    const sizeB = new THREE.Vector3();
    boxB.getSize(sizeB);

    // 거리 기반 빠른 컷 (두 랙 크기 합 기준)
    const dx = group.position.x - other.position.x;
    const dz = group.position.z - other.position.z;
    const radius = (Math.max(sizeA.x, sizeA.z) + Math.max(sizeB.x, sizeB.z)) * 0.6;
    if (dx * dx + dz * dz > radius * radius) return false;

    return intersectsStrictly(boxA, boxB);
  });
}

// 실제 겹침 판정
function intersectsStrictly(a, b, ratioThreshold = 0.05) {
  const overlapMin = new THREE.Vector3(
    Math.max(a.min.x, b.min.x),
    Math.max(a.min.y, b.min.y),
    Math.max(a.min.z, b.min.z)
  );
  const overlapMax = new THREE.Vector3(
    Math.min(a.max.x, b.max.x),
    Math.min(a.max.y, b.max.y),
    Math.min(a.max.z, b.max.z)
  );

  const dx = overlapMax.x - overlapMin.x;
  const dy = overlapMax.y - overlapMin.y;
  const dz = overlapMax.z - overlapMin.z;
  if (dx <= 0 || dy <= 0 || dz <= 0) return false;

  const overlapVolume = dx * dy * dz;
  const volumeA = (a.max.x - a.min.x) * (a.max.y - a.min.y) * (a.max.z - a.min.z);
  const volumeB = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);

  // 작은 쪽 부피 기준으로 비율 계산
  const minVolume = Math.min(volumeA, volumeB);
  const ratio = overlapVolume / minVolume;

  // 절대 임계값도 작은 쪽 기준
  const dynamicThreshold = minVolume * 0.02; // 작은 박스의 2% 이상 겹치면 true

  return ratio > ratioThreshold || overlapVolume > dynamicThreshold;
}


function updateBoundingBox(group) {
  if (!group) return;
  group.userData.boundingBox = getAccurateRackBoundingBox(group);
}

// 랙 충돌 계산 함수
function getAccurateRackBoundingBox(group) {
  const worldPos = new THREE.Vector3();
  group.getWorldPosition(worldPos);

  const rotY = group.rotation.y % (2 * Math.PI);
  const rotStep = Math.round(rotY / (Math.PI / 2)) % 4;
  const isRotated = rotStep % 2 === 1;

  const w = isRotated ? group.userData.depth : group.userData.width;
  const d = isRotated ? group.userData.width : group.userData.depth;
  const h = group.userData.floors * cellH;

  const min = new THREE.Vector3(worldPos.x - w / 2, worldPos.y, worldPos.z - d / 2);
  const max = new THREE.Vector3(worldPos.x + w / 2, worldPos.y + h, worldPos.z + d / 2);

  return new THREE.Box3(min, max);
}

function getStackBoundingBox(rack) {
  const visited = new Set();
  const stack = [];

  const collect = (node) => {
    if (!node || visited.has(node)) return;
    visited.add(node);
    stack.push(node);

    if (node.userData.stackAbove) node.userData.stackAbove.forEach(collect);
    if (node.userData.stackBelow) collect(node.userData.stackBelow);
  };
  collect(rack);

  let stackBox = null;
  stack.forEach(r => {
    const box = getAccurateRackBoundingBox(r);
    if (!stackBox) stackBox = box.clone();
    else stackBox.union(box);
  });

  return stackBox;
}

// 랙과 그리드의 겹침판정
function isOutOfGridBounds(testBox) {
  const padding = 0.1;

  const minX = floorOffsetX - gridWidth / 2 - cellW + padding;
  const maxX = floorOffsetX + gridWidth / 2 + cellW - padding;
  const minZ = floorOffsetZ - gridDepth / 2 - cellD + padding;
  const maxZ = floorOffsetZ + gridDepth / 2 + cellD - padding;

  return (
    testBox.min.x < minX ||
    testBox.max.x > maxX ||
    testBox.min.z < minZ ||
    testBox.max.z > maxZ
  );
}

// 드래그 중 자기 스택 체인을 후보에서 제외
function getStackRoot(node) {
  let cur = node;
  while (cur && cur.userData && cur.userData.stackBelow) {
    cur = cur.userData.stackBelow;
  }
  return cur || node;
}

function markStackChainFrom(root, flag) {
  const stack = [root];
  const visited = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || visited.has(n)) continue;
    visited.add(n);

    // 드래그 중 쌓기 후보에서 제외하기 위한 플래그
    n.userData._excludeAsStackTarget = flag;

    const above = (n.userData && n.userData.stackAbove) || [];
    for (const u of above) stack.push(u);
  }
}

// 쌓은 위 아래 랙 판별
function linkStackRelation(upper, lower) {
  upper.userData.stackBelow = lower;
  lower.userData.stackAbove = lower.userData.stackAbove || [];
  lower.userData.stackAbove.push(upper);
}

// 스택 관계 해제 (삭제할 때)
function unlinkStackRelation(group) {
  const below = group.userData.stackBelow;
  const above = group.userData.stackAbove || [];

  // 밑과의 관계 끊기
  if (below) {
    below.userData.stackAbove = (below.userData.stackAbove || []).filter(g => g !== group);
    group.userData.stackBelow = null;
  }

  // 위와의 관계도 끊어야 "새로운 스택"으로 독립됨
  if (above.length > 0) {
    above.forEach(up => {
      if (up.userData.stackBelow === group) {
        up.userData.stackBelow = null;
      }
    });
    group.userData.stackAbove = [];
  }
}

// 아래 랙이 없으면 위에 있던 랙들이 이동
function updateFloatingStacks() {
  const stackGap = 15;

  // 관계 초기화
  rackGroups.forEach(r => {
    r.userData.stackBelow = null;
    r.userData.stackAbove = [];
  });

  // Y좌표 낮은 순으로 정렬
  const sorted = [...rackGroups].sort((a, b) => a.position.y - b.position.y);

  // boundingBox 캐싱
  const boxCache = new Map();
  sorted.forEach(r => {
    boxCache.set(r, r.userData.boundingBox || getAccurateRackBoundingBox(r));
  });

  for (let i = 0; i < sorted.length; i++) {
    const rack = sorted[i];
    let bestBelow = null;
    let bestY = -Infinity;

    const boxA = boxCache.get(rack);
    const cxA = (boxA.min.x + boxA.max.x) / 2;
    const czA = (boxA.min.z + boxA.max.z) / 2;

    // 역순 탐색 + break
    for (let j = i - 1; j >= 0; j--) {
      const other = sorted[j];

      // 빠른 거리 필터
      const dx = Math.abs(other.position.x - cxA);
      if (dx > cellW * 2) continue;
      const dz = Math.abs(other.position.z - czA);
      if (dz > cellD * 2) continue;

      const boxB = boxCache.get(other);

      // XY overlap 체크
      if (
        boxA.max.x > boxB.min.x &&
        boxA.min.x < boxB.max.x &&
        boxA.max.z > boxB.min.z &&
        boxA.min.z < boxB.max.z
      ) {
        if (boxB.max.y > bestY) {
          bestBelow = other;
          bestY = boxB.max.y;
          break; // **첫 매치로 바로 종료**
        }
      }
    }

    let newY;
    const thisEven = Math.floor(rack.userData.depth / cellD) % 2 === 0;

    if (bestBelow) {
      const belowEven = Math.floor(bestBelow.userData.depth / cellD) % 2 === 0;
      const evenAdjust =
        (belowEven ? -cellH / 2 : 0) + (thisEven ? cellH / 2 : 0);

      newY =
        bestBelow.position.y +
        bestBelow.userData.floors * cellH +
        stackGap +
        evenAdjust;

      rack.userData.stackBelow = bestBelow;
      bestBelow.userData.stackAbove.push(rack);
    } else {
      const floorY = floorMesh ? floorMesh.position.y + 30 : 30;
      newY = floorY;
    }

    // 위치 보정 필요 시만 적용
    if (Math.abs(rack.position.y - newY) > 0.01) {
      rack.position.y = newY;
      rack.updateMatrixWorld(true);

      if (rack.userData.type === "rack") {
        updateRackFromEdge(rack);
      } else if (rack.userData.type === "pallet") {
        updatePalletTransform(
          rack,
          rack.position.clone(),
          rack.rotation.y
        );
      }

      // boundingBox 갱신
      const newBox = getAccurateRackBoundingBox(rack);
      boxCache.set(rack, newBox);
      rack.userData.boundingBox = newBox;
    }
  }

  // 스택 루트마다 stackBox 저장
  rackGroups.forEach(rack => {
    if (!rack.userData.stackBelow) {
      rack.userData.stackBox = getStackBoundingBox(rack);
    }
  });
}



// 선택된 랙 저장
function copySelectedRacks() {
  if (selectedRackGroups.length === 0 && multiSelectEdge?.visible) {
    multiSelectEdge.geometry.computeBoundingBox();
    const edgeBox = new THREE.Box3().setFromObject(multiSelectEdge);

    selectedRackGroups = rackGroups.filter(g => {
      const box = getAccurateRackBoundingBox(g);
      return edgeBox.intersectsBox(box);
    });
  }

  if (selectedRackGroups.length === 0 && !selectedGroup) {
    alert('먼저 복사할 랙을 선택하세요.');
    return;
  }

  const candidates = selectedRackGroups.length > 0 ? selectedRackGroups : [selectedGroup];

  // 전체 영역의 "왼쪽 하단" 좌표 구하기
  let minX = Infinity, maxZ = -Infinity, baseY = 0;

  candidates.forEach(g => {
    const box = getAccurateRackBoundingBox(g); // 정확한 박스 얻기
    if (box.min.x < minX) minX = box.min.x;    // 왼쪽 끝
    if (box.max.z > maxZ) maxZ = box.max.z;    // 하단 끝
    baseY = g.position.y;
  });

  // 기준점에서 offset 계산
  copiedRackData = candidates.map(g => ({
    type: g.userData.type,
    cols: g.userData.cols,
    floors: g.userData.floors,
    depth: g.userData.depth,
    rotationY: g.rotation.y,
    offsetX: g.position.x - minX,
    offsetY: g.position.y - baseY,
    offsetZ: g.position.z - maxZ,
    baseY: baseY,
    cellW: g.userData.cellW || 100
  }));
}


// 선택된 랙 마우스 위치에 붙여넣기
function pasteCopiedRacks() {
  if (!copiedRackData.length) return;

  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((lastMouseX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((lastMouseY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (!raycaster.ray.intersectPlane(floorPlane, intersectPoint)) return;

  const originX = intersectPoint.x;
  const originZ = intersectPoint.z;
  const originY = copiedRackData[0].baseY ?? 0; // baseY 사용
  const tempGroups = [];

  for (const data of copiedRackData) {
    const posX = originX + data.offsetX;
    const posY = originY + (data.offsetY ?? 0);
    const posZ = originZ + data.offsetZ;

    const temp = (data.type === 'pallet')
      ? createPalletRack(0, 0, data.cols, Math.round(data.depth / cellD), false)
      : createRealisticShelf(0, 0, data.cols, data.floors, data.depth, data.cellW, false);

    temp.rotation.y = data.rotationY;

    const { offsetX, offsetZ } = getOffsetFromGroup(temp);
    const { x: clampedX, z: clampedZ } = clampToGridBoundsUnified(posX, posZ, offsetX, offsetZ);
    temp.position.set(clampedX, posY, clampedZ);
    temp.updateMatrixWorld(true);

    let overlap = isTooMuchOverlap(temp, null);
    const outOfBounds = isOutOfGridBounds(getAccurateRackBoundingBox(temp));

    let res = null;
    if (!outOfBounds) {
      res = findStackTargetAndY(temp);
      if (res.ok && res.target) {
        // 스택 가능한 경우는 overlap 무시
        overlap = false;
      }
    }

    tempGroups.push(temp);

    if (outOfBounds || overlap) {
      tempGroups.forEach(g => {
        safeRemoveEdge(g.userData.edge);
        scene.remove(g);
      });
      alert(outOfBounds
        ? '붙여넣을 위치가 바닥을 벗어났습니다.'
        : '붙여넣을 위치에 이미 랙이 있습니다.');
      return;
    }
  }

  const pasted = [];

  tempGroups.forEach((temp, i) => {
    const data = copiedRackData[i];

    const group = (data.type === 'pallet')
      ? createPalletRack(temp.position.x, temp.position.z, data.cols, Math.round(data.depth / cellD), true)
      : createRealisticShelf(temp.position.x, temp.position.z, data.cols, data.floors, data.depth, data.cellW, true);

    group.rotation.y = temp.rotation.y;
    group.position.copy(temp.position);
    group.updateMatrixWorld(true);

    safeRemoveEdge(temp.userData.edge);
    scene.remove(temp);

    scene.add(group);
    rackGroups.push(group);
    dragHandles.push(group.userData.edge);

    group.userData.stackAbove = [];
    group.userData.stackBelow = null;

    if (data.type === 'rack') {
      updateRackFromEdge(group);
    } else if (data.type === 'pallet') {
      updatePalletTransform(group, group.position.clone(), group.rotation.y);
    }
    if (data.type === 'rack') {
      const res = findStackTargetAndY(group);
      if (res.ok && res.target) {
        const topRack = res.target;

        const colsOK = (group.userData.cols === topRack.userData.cols);
        const depthOK = (group.userData.depth === topRack.userData.depth);
        const rotA = Math.round((group.rotation.y % (2 * Math.PI)) / (Math.PI / 2)) % 4;
        const rotB = Math.round((topRack.rotation.y % (2 * Math.PI)) / (Math.PI / 2)) % 4;
        const rotOK = (rotA % 2 === rotB % 2);

        if (colsOK && depthOK && rotOK) {
          group.position.set(topRack.position.x, res.y, topRack.position.z);
          group.rotation.y = topRack.rotation.y;
          linkStackRelation(group, topRack);

          // 풀에도 반영
          updateRackFromEdge(group);
        } else {
          group.position.y = 0;
          updateRackFromEdge(group);
        }
      } else {
        group.position.y = 0;
        updateRackFromEdge(group);
      }
    } else if (data.type === 'pallet') {
      updatePalletTransform(group, group.position.clone(), group.rotation.y);
    }
    pasted.push(group);
  });

  if (pasted.length > 0) {
    selectedGroup = pasted[0];
    selectedRackGroups = pasted;
    updateMultiSelectEdge(); // edge 상태 갱신
  }
}

function updatePerfOverlay() {
  const i = renderer.info;

  // 전체 박스 슬롯 수
  let totalSlots = 0;
  rackGroups.forEach(g => {
    if (g.userData.slots) {
      totalSlots += g.userData.slots.length;
    }
  });

  // 랙/파레트/영역선 개수 집계
  let rackCount = rackGroups.filter(g => g.userData.type === 'rack').length;
  let palletCount = rackGroups.filter(g => g.userData.type === 'pallet').length;
  let lineCount = markingLines.length;

  const text =
    '[render]\n' +
    `calls: ${i.render.calls}\n` +
    `triangles: ${i.render.triangles}\n` +
    '[counts]\n' +
    `racks: ${rackCount}\n` +
    `pallets: ${palletCount}\n` +
    `lines: ${lineCount}\n` +
    '[boxslots]\n' +
    `${totalSlots}`;

  const box = document.getElementById('perf-box');
  if (box) box.textContent = text;
}


// 메모리 해제 유틸
function disposeMaterial(mat) {
  if (!mat) return;
  const mats = Array.isArray(mat) ? mat : [mat];
  mats.forEach(m => {
    // 텍스처 맵들 해제
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'envMap'].forEach(k => {
      if (m[k] && m[k].dispose) m[k].dispose();
    });
    if (m.dispose) m.dispose();
  });
}

function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    if (o.material) disposeMaterial(o.material);
  });
}

function updateRackFromEdge(group) {
  if (!group || !group.userData) return;
  const key = group.userData.poolKey;
  const pool = rackPools[key];
  if (!pool) return;

  const idx = group.userData.index;
  if (idx < 0 || idx >= pool.count) return;

  const mat4 = new THREE.Matrix4();
  mat4.compose(
    group.position.clone(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, group.rotation.y, 0)),
    new THREE.Vector3(1, 1, 1)
  );

  pool.setMatrixAt(idx, mat4);
  pool.instanceMatrix.needsUpdate = true;
  updateBoundingBox(group);
}


function updatePalletTransform(group, position, rotationY) {
  if (!group || !group.userData) return;
  const key = group.userData.poolKey;
  const pool = palletPools[key];
  if (!pool) return;

  const idx = group.userData.index;
  if (idx < 0 || idx >= pool.count) return;

  const mat4 = new THREE.Matrix4();
  mat4.compose(
    position.clone(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(1, 1, 1)
  );

  pool.setMatrixAt(idx, mat4);
  pool.instanceMatrix.needsUpdate = true;
}

function updateMultiSelectEdge() {
  if (multiSelectEdge) {
    scene.remove(multiSelectEdge);
    disposeObject(multiSelectEdge);
    multiSelectEdge = null;
  }
  if (selectedRackGroups.length <= 1) return;

  const group = new THREE.Group();
  group.userData.type = "multiEdge";

  // 스택 단위로 묶되 선택된 랙만 포함
  const visited = new Set();

  for (const g of selectedRackGroups) {
    if (visited.has(g)) continue;

    // 같은 스택에 속한 것 중 "선택된" 랙만 모음
    const stack = [];
    const collect = (n) => {
      if (!n || visited.has(n)) return;
      if (!selectedRackGroups.includes(n)) return;
      visited.add(n);
      stack.push(n);
      if (n.userData.stackAbove) n.userData.stackAbove.forEach(collect);
      if (n.userData.stackBelow) collect(n.userData.stackBelow);
    };
    collect(g);

    // 스택 내 선택된 것만 박스 합치기
    if (stack.length > 0) {
      const box = new THREE.Box3();
      stack.forEach(r => {
        const bb = getAccurateRackBoundingBox(r);
        box.union(bb);
      });
      const yPadding = 20;

      const points = [
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y + yPadding, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y + yPadding, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y + yPadding, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y + yPadding, box.max.z),
      ];

      const geometry = new ConvexGeometry(points);
      const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      const edgeMesh = new THREE.Mesh(geometry, material);
      group.add(edgeMesh);
    }
  }

  scene.add(group);
  multiSelectEdge = group;

  // 개별 edge 끄기
  rackGroups.forEach(g => { if (g.userData.edge) g.userData.edge.visible = false; });
}

// 랙 드래그 시작, 중간, 드랍
function enableDrag() {
  if (dragControls) dragControls.dispose();
  let dragTargets = [];
  if (multiSelectEdge) {
    // 다중 선택 → 큰 엣지 하나만
    dragTargets = [multiSelectEdge];
  } else {
    // 단일 선택 → 개별 엣지들
    dragTargets = dragHandles;
  }
  dragControls = new DragControls(dragTargets, camera, renderer.domElement);
  dragControls.transformGroup = false;
  dragControls.activate();

  dragControls.addEventListener('dragstart', (e) => {
    updateFloatingStacks()
    if (currentPreviewMode && previewRack) {
      dragControls.enabled = false; // 생성 모드일 땐 드래그 비활성화
      return;
    }
    if (e.ctrlKey || window.e?.ctrlKey) {
      if (multiSelectEdge) {
        scene.remove(multiSelectEdge);
        multiSelectEdge = null;
      }
      selectedRackGroups = [];

      dragControls.enabled = false;
      setTimeout(() => dragControls.enabled = true, 0);
      return;
    }

    const edge = e.object;
    const group = rackGroups.find(g => g.userData.edge === edge);
    if (!group || !isEditMode) return;
    if (isLineDrawingMode) return;

    // 다중선택 배열 보정
    if (multiSelectEdge?.visible && selectedRackGroups.length === 0) {
      multiSelectEdge.geometry.computeBoundingBox();
      const edgeBox = new THREE.Box3().setFromObject(multiSelectEdge);
      selectedRackGroups = rackGroups.filter(g => {
        const box = getAccurateRackBoundingBox(g);
        return edgeBox.intersectsBox(box);
      });
    }

    orbitControls.enabled = false;
    gridHelper.visible = isEditMode;

    // draggingGroups 결정 로직
    if (selectedRackGroups.length > 1 && selectedRackGroups.includes(group)) {
      // 다중 선택된 상태 → 같이 드래그
      draggingGroups = [...selectedRackGroups];
    } else {
      // 단일 선택 → 내가 집은 것만
      draggingGroups = [group];
    }

    draggingGroups.forEach(g => {
      const root = getStackRoot(g);
      markStackChainFrom(root, true);
    });

    const baseGroup = draggingGroups[0];
    dragSnapLock.active = true;
    dragSnapLock.locked = false;
    dragSnapLock.target = null;
    dragSnapLock.y = 0;
    baseGroup.userData._preDragY = baseGroup.position.y;
    const basePos = baseGroup.position.clone();
    const { offsetX, offsetZ } = getOffsetFromGroup(baseGroup);

    draggingGroups.forEach(g => {
      g.userData.fixedOffsetX = offsetX;
      g.userData.fixedOffsetZ = offsetZ;
      g.userData.dragOffsetFromBase = new THREE.Vector3(
        g.position.x - basePos.x,
        g.position.y,
        g.position.z - basePos.z
      );
      g.userData._dragBox = getAccurateRackBoundingBox(g).clone();
    });

    // 클러스터 정보 저장 
    const __origClusterMap = new Map();
    draggingGroups.forEach(g => {
      const root = getStackRoot(g);
      if (!__origClusterMap.has(root)) __origClusterMap.set(root, []);
      __origClusterMap.get(root).push(g);
    });
    __origClusterMap.forEach(members => {
      const bottom = members.find(m => !m.userData.stackBelow) || members[0];
      const baseY = bottom.position.y;
      members.forEach(m => {
        m.userData._origClusterBottom = bottom;
        m.userData._origY = m.position.y;              // 절대 Y 저장
        m.userData._origDeltaY = m.position.y - baseY; // 상대 Y 저장
        m.userData._cluster = draggingGroups.filter(x => getStackRoot(x) === getStackRoot(m));
      });
    });

    updateRayFromLastMouse();
    if (raycaster.ray.intersectPlane(floorPlane, intersectPoint)) {
      draggingGroups.forEach(g => {
        g.userData.lastX = g.position.x;
        g.userData.lastY = g.position.y;
        g.userData.lastZ = g.position.z;
        g.userData.dragOffset = new THREE.Vector3().subVectors(g.position, intersectPoint);
      });
    }

    isMultiDragging = draggingGroups.length > 1;
    multiDragAnchor = draggingGroups[0];

    rackGroups.forEach(g => { if (g.userData.edge) g.userData.edge.visible = false; });
    if (!isMultiDragging) {
      draggingGroups.forEach(g => { if (g.userData.edge) g.userData.edge.visible = true; });
    }
  });


  dragControls.addEventListener('drag', () => {
    if (!draggingGroups.length) return;
    if (_dragFrameScheduled) return;
    _dragFrameScheduled = true;

    requestAnimationFrame(() => {
      _dragFrameScheduled = false;

      updateRayFromLastMouse();
      if (!raycaster.ray.intersectPlane(floorPlane, intersectPoint)) return;

      const tmp = new THREE.Vector3();

      // 공통 이동 (임시 적용)
      draggingGroups.forEach(g => {
        const offset = g.userData.dragOffset || tmp.set(0, 0, 0);
        let targetX = intersectPoint.x + offset.x;
        let targetZ = intersectPoint.z + offset.z;

        if (!isMultiDragging) {
          g.position.set(targetX, 0, targetZ);
        } else {
          g.position.set(targetX, g.position.y, targetZ);
        }
      });

      // 단일 드래그
      if (!isMultiDragging) {
        const g = draggingGroups[0];

        // 바닥 clamp (bounding box 기준)
        const box = getAccurateRackBoundingBox(g);
        const gridMinX = floorOffsetX - gridWidth / 2;
        const gridMaxX = floorOffsetX + gridWidth / 2;
        const gridMinZ = floorOffsetZ - gridDepth / 2;
        const gridMaxZ = floorOffsetZ + gridDepth / 2;

        let dx = 0, dz = 0;
        if (box.min.x < gridMinX) dx = gridMinX - box.min.x;
        if (box.max.x > gridMaxX) dx = gridMaxX - box.max.x;
        if (box.min.z < gridMinZ) dz = gridMinZ - box.min.z;
        if (box.max.z > gridMaxZ) dz = gridMaxZ - box.max.z;

        g.position.x += dx;
        g.position.z += dz;

        // 스택 판정
        const res = findStackTargetAndY(g);
        if (res.ok) {
          g.position.y = res.y;
          g.rotation.y = res.target.rotation.y;
          g.userData._hoverStackTarget = res.target;
          g.userData._hoverStackY = res.y;
          g.userData._hoverStackOK = true;
        } else {
          g.userData._hoverStackTarget = null;
          g.userData._hoverStackOK = false;
          if (Math.abs(g.position.x - g.userData.lastX) < cellW / 2 &&
            Math.abs(g.position.z - g.userData.lastZ) < cellD / 2) {
            g.position.y = g.userData.lastY;
          } else {
            g.position.y = 0;
          }
        }

        if (g.userData.type === 'rack') updateRackFromEdge(g);
        else updatePalletTransform(g, g.position.clone(), g.rotation.y);
      }

      // 다중 드래그
      if (isMultiDragging) {
        const basePos = multiDragAnchor.position.clone();

        draggingGroups.forEach(g => {
          g.position.x = basePos.x + g.userData.dragOffsetFromBase.x;
          g.position.z = basePos.z + g.userData.dragOffsetFromBase.z;
        });

        // 전체 bounding box
        const multiBox = new THREE.Box3();
        draggingGroups.forEach(g => multiBox.union(getAccurateRackBoundingBox(g)));

        const gridMinX = floorOffsetX - gridWidth / 2;
        const gridMaxX = floorOffsetX + gridWidth / 2;
        const gridMinZ = floorOffsetZ - gridDepth / 2;
        const gridMaxZ = floorOffsetZ + gridDepth / 2;

        let dx = 0, dz = 0;
        if (multiBox.min.x < gridMinX) dx = gridMinX - multiBox.min.x;
        if (multiBox.max.x > gridMaxX) dx = gridMaxX - multiBox.max.x;
        if (multiBox.min.z < gridMinZ) dz = gridMinZ - multiBox.min.z;
        if (multiBox.max.z > gridMaxZ) dz = gridMaxZ - multiBox.max.z;

        draggingGroups.forEach(g => {
          g.position.x += dx;
          g.position.z += dz;
        });

        // 스택 클러스터별로 판정/적용
        const clusterMap = new Map();
        draggingGroups.forEach(g => {
          const root = getStackRoot(g);
          if (!clusterMap.has(root)) clusterMap.set(root, []);
          clusterMap.get(root).push(g);
        });

        const floorY = floorMesh ? floorMesh.position.y + 30 : 30;
        clusterMap.forEach(members => {
          // 드래그 시작 시 저장해둔 원래 바닥 랙 기준 유지
          let targetYBase = floorY;
          let targetRot = 0;
          const bottom = members[0].userData._origClusterBottom ||
            [...members].sort((a, b) =>
              (a.userData._origLevel ?? 0) - (b.userData._origLevel ?? 0)
            )[0];
          const res = findStackTargetAndY(bottom);
          if (res.ok) {
            targetYBase = res.y;
            targetRot = res.target.rotation.y;
          }

          members.forEach(m => {
            const deltaY = (typeof m.userData._origDeltaY === 'number')
              ? m.userData._origDeltaY
              : (m.userData._origLevel ?? 0) * cellH;
            m.position.y = targetYBase + deltaY;

            if (m.userData.type === 'rack') updateRackFromEdge(m);
            else updatePalletTransform(m, m.position.clone(), m.rotation.y);
          });
        });

        updateMultiSelectEdge();
      }
    });
  });

  draggingGroups.forEach(g => {
    updateRackFromEdge(g);
  });
  let dragEndQueued = false;

  dragControls.addEventListener('dragend', () => {
    if (dragEndQueued) return;
    dragEndQueued = true;

    requestAnimationFrame(() => {
      if (!draggingGroups.length) {
        dragEndQueued = false;
        return;
      }

      const wasMultiDragging = isMultiDragging;
      const movedGroups = [...draggingGroups];
      const excludeSet = new Set(movedGroups);

      let stackSuccess = false;

      // 다중 드래그
      if (wasMultiDragging) {
        const clusterMap = new Map();
        movedGroups.forEach(g => {
          const root = getStackRoot(g);
          if (!clusterMap.has(root)) clusterMap.set(root, []);
          clusterMap.get(root).push(g);
        });

        clusterMap.forEach(members => {
          members.forEach(m => unlinkStackRelation(m));

          // 클러스터에서 제일 아래층 찾기
          const bottom = [...members].sort((a, b) => a.position.y - b.position.y)[0];
          const res = findStackTargetAndY(bottom);

          if (res.ok && res.target) {
            // 스택 성공: 그룹 전체를 블록처럼 올림
            const baseY = res.y;
            const baseRot = res.target.rotation.y;

            members.forEach(m => {
              const deltaY = m.position.y - bottom.position.y;
              m.position.set(res.target.position.x, baseY + deltaY, res.target.position.z);
              m.rotation.y = baseRot;

              if (m === bottom) linkStackRelation(m, res.target);
              else linkStackRelation(m, bottom);

              if (m.userData.type === 'rack') updateRackFromEdge(m);
              else updatePalletTransform(m, m.position.clone(), m.rotation.y);

              m.userData._hoverStackTarget = null;
              m.userData._hoverStackOK = false;
            });
            stackSuccess = true;
          } else {
            // 스택 실패: 그냥 이동 확정 (XZ 스냅, Y 그대로)
            members.forEach(m => {
              const snap = clampToGridBoundsUnified(
                m.position.x,
                m.position.z,
                m.userData.fixedOffsetX,
                m.userData.fixedOffsetZ
              );
              m.position.set(snap.x, m.userData._origY ?? m.position.y, snap.z);

              if (m.userData.type === 'rack') updateRackFromEdge(m);
              else updatePalletTransform(m, m.position.clone(), m.rotation.y);

              m.userData._hoverStackTarget = null;
              m.userData._hoverStackOK = false;
            });
          }
        });

      } else {
        // 단일 드래그
        const g = movedGroups[0];
        const res = findStackTargetAndY(g);

        if (res.ok && res.target) {
          // 스택 성공
          g.position.set(res.target.position.x, res.y, res.target.position.z);
          g.rotation.y = res.target.rotation.y;
          linkStackRelation(g, res.target);
          stackSuccess = true;
        } else {
          // 스택 실패 → 그냥 이동 확정 (바닥 스냅)
          const snap = clampToGridBoundsUnified(
            g.position.x,
            g.position.z,
            g.userData.fixedOffsetX,
            g.userData.fixedOffsetZ
          );
          g.position.set(snap.x, g.userData._origY ?? g.position.y, snap.z);
        }

        if (g.userData.type === 'rack') updateRackFromEdge(g);
        else updatePalletTransform(g, g.position.clone(), g.rotation.y);

        g.userData._hoverStackTarget = null;
        g.userData._hoverStackOK = false;
      }

      // 겹침/범위 벗어나면 원위치 복귀
      if (!stackSuccess) {
        const anyOverlap = movedGroups.some(g => isTooMuchOverlap(g, excludeSet));
        const anyOut = movedGroups.some(g => isOutOfGridBounds(getAccurateRackBoundingBox(g)));
        if (anyOverlap || anyOut) {
          movedGroups.forEach(g => {
            g.position.set(g.userData.lastX, g.userData.lastY, g.userData.lastZ);
            g.updateMatrixWorld(true);
            if (g.userData.type === 'rack') updateRackFromEdge(g);
            else updatePalletTransform(g, g.position.clone(), g.rotation.y);
          });
        }
      }
      // 후처리
      selectedRackGroups = [...movedGroups];
      selectedGroup = movedGroups[0];
      draggingGroups = [];
      dragEndQueued = false;

      // 빠진 자리 / 쌓기 위치 정리
      updateFloatingStacks();
      orbitControls.enabled = true;

      // exclude 플래그 해제
      movedGroups.forEach(g => {
        const root = getStackRoot(g);
        markStackChainFrom(root, false);
        g.userData._hoverStackTarget = null;
        g.userData._hoverStackOK = false;
      });

      rackGroups.forEach(g => {
        const root = getStackRoot(g);
        markStackChainFrom(root, false);
        if (g.userData.edge) g.userData.edge.visible = false;
      });

      if (selectedRackGroups.length > 1) updateMultiSelectEdge();
      else if (selectedRackGroups.length === 1) {
        const g = selectedRackGroups[0];
        if (g.userData.edge) g.userData.edge.visible = true;
      }
      if (selectedRackGroups.length <= 1) {
        selectedRackGroups = [...movedGroups]; // 단일만 유지
      }

      isMultiDragging = false;
      multiDragAnchor = null;
    });
  });
  orbitControls.enabled = true;
}

// 클릭 판정
window.addEventListener('click', (event) => {
  if (event.button === 2) return;
  if (event.target !== renderer.domElement) return;
  if (event.ctrlKey) {
    return;
  }
  if (skipNextClick) {
    skipNextClick = false;
    return;
  }

  // 마우스 위치 기준 raycasting 준비
  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const floorIntersects = raycaster.intersectObject(floorMesh);

  if (currentPreviewMode && previewRack) {
    if (
      previewRack &&
      floorIntersects.length === 0 &&
      !event.target.closest('#side-panel')
    ) {
      removePreviewRack();
      currentPreviewMode = null;
      lastLinePoint = null;
      gridHelper.visible = false;
    }
    return;
  }

  // 선 생성
  if (isLineDrawingMode) {
    if (!isEditMode) return;

    const floorHits = raycaster.intersectObject(floorMesh);
    if (floorHits.length > 0) {
      const raw = floorHits[0].point;
      const { x, z } = clampToGridBoundsUnified(raw.x, raw.z);
      const point = new THREE.Vector3(x, 0.7, z);

      if (!lastLinePoint) {
        // 첫 점
        lastLinePoint = point.clone();
        activePolylinePoints = [lastLinePoint.clone()];
      } else {
        // 닫힘 판정: 첫 점 근처 + 최소 3변 이상일 때
        const first = activePolylinePoints[0];
        const close =
          Math.abs(point.x - first.x) < 1e-6 &&
          Math.abs(point.z - first.z) < 1e-6 &&
          activePolylinePoints.length >= 3;

        if (close) {
          // 최종 완성 라인
          if (activePolyline) {
            scene.remove(activePolyline);
            markingLines = markingLines.filter(l => l !== activePolyline);
            activePolyline = null;
          }

          const finalPts = [...activePolylinePoints, first.clone()];
          const finalGroup = createThickMarkingLine(finalPts, 0xffcc00, 30);
          scene.add(finalGroup);
          markingLines.push(finalGroup);

          // 프리뷰 정리
          if (previewLine) {
            scene.remove(previewLine);
            previewLine = null;
          }

          // 모드 상태 초기화
          lastLinePoint = null;
          activePolylinePoints = [];
          gridHelper.visible = false;
          return;
        }

        // 일반 연장: 새로운 점 추가
        activePolylinePoints.push(point.clone());

        // 이전 미완성 선 제거 후 다시 생성
        if (activePolyline) {
          scene.remove(activePolyline);
          markingLines = markingLines.filter(l => l !== activePolyline);
          activePolyline = null;
        }

        activePolyline = createThickMarkingLine(activePolylinePoints, 0xffcc00, 30);
        scene.add(activePolyline);
        markingLines.push(activePolyline);

        lastLinePoint = point.clone();
      }

      // 프리뷰 제거 (다음 점 후보는 mousemove에서 다시 그림)
      if (previewLine) {
        scene.remove(previewLine);
        previewLine = null;
      }
      return;
    } else {
      // 바닥 클릭이 아니면 종료
      isLineDrawingMode = false;
      lastLinePoint = null;
      activePolyline = null;
      activePolylinePoints = [];
      if (previewLine) {
        scene.remove(previewLine);
        previewLine = null;
      }
      gridHelper.visible = false;
      return;
    }
  }

  //박스 선택모드
  if (isBoxSelectMode) {
    let hitBox = null;
    let hitSlot = null;

    rackGroups.forEach(group => {
      if (!group.userData.boxMesh) return;

      const boxMesh = group.userData.boxMesh;
      const slots = group.userData.slots;

      slots.forEach(slot => {
        if (!slot.occupied || slot.instanceIndex === undefined) return;

        // 슬롯 중심 좌표
        const pos = slot.worldPosition.clone();
        group.localToWorld(pos);

        // 박스 크기 (인스턴스와 동일하게 맞춰줌)
        const boxW = (group.userData.cellW || cellW) * 0.8;
        const boxH = cellH * 0.7;
        const boxD = cellD * 0.9;

        const box3 = new THREE.Box3().setFromCenterAndSize(
          pos,
          new THREE.Vector3(boxW, boxH, boxD)
        );

        // ray와 교차 판정
        if (raycaster.ray.intersectsBox(box3)) {
          hitBox = boxMesh;
          hitSlot = slot;
        }
      });
    });

    // 선택된 슬롯이 있으면 색상 변경
    if (hitBox && hitSlot) {
      // 이전 선택 해제
      if (selectedBox && selectedBox.mesh) {
        const defaultColor = new THREE.Color(0xc06d6d);
        selectedBox.mesh.setColorAt(selectedBox.id, defaultColor);
        selectedBox.mesh.instanceColor.needsUpdate = true;
      }

      const highlightColor = new THREE.Color(0xffee00);
      hitBox.setColorAt(hitSlot.instanceIndex, highlightColor);
      hitBox.instanceColor.needsUpdate = true;

      selectedBox = { mesh: hitBox, id: hitSlot.instanceIndex };
    }
  }


  // 랙 엣지 클릭 시 → 해당 랙 선택
  const intersects = raycaster.intersectObjects(rackGroups.map(g => g.userData.edge), true);
  if (intersects.length > 0) {
    const edge = intersects[0].object;
    const group = rackGroups.find(g => g.userData.edge === edge || g.userData.edge === edge.parent);

    if (group) {
      // 기존 edge 전부 끄기 (공통)
      rackGroups.forEach(g => {
        if (g.userData?.edge) g.userData.edge.visible = false;
      });

      if (event.ctrlKey) {
        // Ctrl 클릭 → 다중 선택 유지
        if (!selectedRackGroups.includes(group)) {
          selectedRackGroups.push(group);
        }
        updateMultiSelectEdge();
        if (multiSelectEdge) multiSelectEdge.visible = true;

      } else {
        // 단일 선택 전환
        if (multiSelectEdge) {
          scene.remove(multiSelectEdge);
          disposeObject(multiSelectEdge);
          multiSelectEdge = null;
        }

        selectedGroup = group;
        selectedRackGroups = [group];

        // 단일 edge 표시
        group.userData.edge.visible = true;
        gridHelper.visible = isEditMode;

        // 읽기 모드일 경우 카메라 위치 보정
        if (!isEditMode) {
          const box = getAccurateRackBoundingBox(group);
          const center = new THREE.Vector3(
            (box.min.x + box.max.x) / 2,
            (box.min.y + box.max.y) / 2,
            (box.min.z + box.max.z) / 2
          );

          const dist = camera.position.distanceTo(center);
          if (dist > 2500) {
            camera.position.set(center.x, center.y + 600, center.z + 1200);
            orbitControls.target.copy(center);
            orbitControls.update();
          }
        }
      }

      // 공통 처리
      enableDrag();
      return;
    }
  }

  const lineMeshes = markingLines.flatMap(group => {
    const meshes = [];
    group.traverse(obj => {
      if (obj.isMesh) meshes.push(obj);
    });
    return meshes;
  });

  const markIntersects = raycaster.intersectObjects(lineMeshes, true);
  if (markIntersects.length > 0) {
    // 이전 선택 복원
    if (selectedMarkingLine) {
      selectedMarkingLine.traverse(obj => {
        if (obj.isMesh && obj.material?.color) obj.material.color.set(0xffcc00);
      });
    }

    // 메쉬 → 루트 그룹(markingLine)으로 올림
    let o = markIntersects[0].object;
    while (o && o.userData?.type !== 'markingLine') o = o.parent;
    selectedMarkingLine = o || markIntersects[0].object;

    // 드래그 때도 유지되게 선택 목록에 추가
    selectedMarkingLines ??= [];
    if (!selectedMarkingLines.includes(selectedMarkingLine)) {
      selectedMarkingLines.push(selectedMarkingLine);
    }

    // 순서 동일: 먼저 전체 리셋, 이후 선택 강조
    markingLines.forEach(lineGroup => {
      lineGroup.traverse(obj => {
        if (obj.isMesh && obj.material?.color) obj.material.color.set(0xffcc00);
      });
    });
    selectedMarkingLines.forEach(lineGroup => {
      lineGroup.traverse(obj => {
        if (obj.isMesh && obj.material?.color) obj.material.color.set(0xff6600);
      });
    });

    gridHelper.visible = isEditMode;
    return;
  }

  if (floorIntersects.length > 0) {
    // 바닥 클릭 시 → 선택 해제
    selectedGroup = null;
    selectedRackGroups = [];
    rackGroups.forEach(g => {
      if (g.userData?.edge) g.userData.edge.visible = false;
    });

    // 박스 선택 해제
    if (selectedBox && selectedBox.mesh) {
      const defaultColor = new THREE.Color(0xc06d6d);
      selectedBox.mesh.setColorAt(selectedBox.id, defaultColor);
      selectedBox.mesh.instanceColor.needsUpdate = true;
      selectedBox = null;
    }

    // 선 선택 해제
    if (selectedMarkingLine) {
      selectedMarkingLine.traverse(obj => {
        if (obj.isMesh && obj.material?.color) {
          obj.material.color.set(0xffcc00);
        }
      });
      selectedMarkingLine = null;
    }
    if (selectedMarkingLines.length > 0) {
      selectedMarkingLines.forEach(lineGroup => {
        lineGroup.traverse(obj => {
          if (obj.isMesh && obj.material?.color) {
            obj.material.color.set(0xffcc00);
          }
        });
      });
      selectedMarkingLines = [];
    }
    gridHelper.visible = false;
    updateMultiSelectEdge();
  }
});

//마우스 클릭시 카메라 및 브라우저 변환
window.addEventListener('mousedown', (event) => {
  // 오른쪽 클릭은 무시 (카메라 이동만 허용)
  if (currentPreviewMode && event.button === 2) {
    // 오른쪽 클릭 → 생성 모드 중지
    removePreviewRack();
    currentPreviewMode = null;
    lastLinePoint = null;
    gridHelper.visible = false;
    orbitControls.enabled = true;
    return;
  }
  if (event.button === 2) return;
  (function attachCornerEditStartOnce() {
    if (attachCornerEditStartOnce._done) return;
    attachCornerEditStartOnce._done = true;

    renderer.domElement.addEventListener('mousedown', (e) => {
      if (activeLineEdit) return;
      if (isLineDrawingMode) {
        // 생성 중일 때는 기존 객체 클릭 막기
        return;
      }

      if (!e.ctrlKey) {
        // 드래그 중이 아닐 때만 다중선택 해제
        if (!isMultiDragging && multiSelectEdge) {
          scene.remove(multiSelectEdge);
          multiSelectEdge = null;
        }
      }
      // 바닥 교차 구해두기(없으면 편집 안함)
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, intersectPoint)) return;

      // 모든 영역선 후보 검사
      let best = { dist: Infinity, group: null, index: -1, screenDist: Infinity };
      const clickPx = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);

      (markingLines || []).forEach(group => {
        const pts = group.userData?.points;
        if (!pts || !pts.length) return;

        for (let i = 0; i < pts.length; i++) {
          // 코너의 월드 좌표(그룹이 원점이 아니어도 안전)
          const wp = pts[i].clone();
          group.localToWorld(wp);
          const sp = worldToScreenPx(wp);
          const d = sp.distanceTo(clickPx);
          if (d < best.screenDist) {
            best = { dist: d, group, index: i, screenDist: d };
          }
        }
      });

      if (!best.group || best.screenDist > CORNER_PICK_PX) return;

      // 코너 편집 모드 진입
      activeLineEdit = {
        group: best.group,
        index: best.index,
        isClosed: (() => {
          const pts = best.group.userData.points || [];
          const segs = best.group.userData.segments || [];
          const N = pts.length;
          if (N < 3) return false;
          return segs.some(s => (s.a === 0 && s.b === N - 1) || (s.a === N - 1 && s.b === 0));
        })()
      };
      activeLineEdit.prevPoint = best.group.userData.points[best.index].clone();
      selectedMarkingLine = activeLineEdit.group;                   // 단일 선택 업데이트
      selectedMarkingLines ??= [];
      if (!selectedMarkingLines.includes(activeLineEdit.group)) {   // 목록에 추가
        selectedMarkingLines.push(activeLineEdit.group);
      }
      {
        const g = activeLineEdit.group;

        g.traverse(o => {
          if (!o.isMesh) return;
          if (!o.userData._selCloned) { o.material = o.material.clone(); o.userData._selCloned = true; }
          if (o.geometry?.type === 'CircleGeometry') o.visible = true; // 조인트/캡은 항상 보이게
          if (o.material?.color) o.material.color.setHex(0xff6600);    // 프로젝트 선택색으로 바꿔도 됨
          o.material.opacity = 1.0;
          o.material.transparent = true;
        });

        const pts = g.userData.points;
        const Y = g.userData?.Y ?? pts[0]?.y ?? -5;
        const p = new THREE.Vector3(pts[activeLineEdit.index].x, Y, pts[activeLineEdit.index].z);

        const joints = g.children.filter(o =>
          o.isMesh &&
          o.geometry?.type === 'CircleGeometry' &&
          ((o.geometry.parameters?.thetaLength ?? Math.PI * 2) > Math.PI) // 전체 원(조인트)
        );
        activeLineEdit.marker = joints.reduce((best, o) => {
          const d = o.position.distanceTo(p);
          return d < best.d ? { o, d } : best;
        }, { o: null, d: Infinity }).o;
      }

      // 프리뷰 라인 제거
      if (typeof previewLine !== 'undefined' && previewLine) {
        scene.remove(previewLine);
        previewLine = null;
      }

      // 카메라 잠금 + 휠 차단
      if (_savedOrbitState == null) {
        _savedOrbitState = {
          enabled: orbitControls.enabled,
          enablePan: orbitControls.enablePan,
          enableRotate: orbitControls.enableRotate,
          enableZoom: orbitControls.enableZoom,
        };
        orbitControls.enabled = false;
        orbitControls.enablePan = false;
        orbitControls.enableRotate = false;
        orbitControls.enableZoom = false;

        _lineDragWheelBlocker = (ev) => ev.preventDefault();
        renderer.domElement.addEventListener('wheel', _lineDragWheelBlocker, { passive: false });
        gridHelper.visible = true;
      }
    }, { capture: true });
  })();


  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(rackGroups.map(g => g.userData.edge), true);

  if (intersects.length > 0) {
    orbitControls.enabled = false;
  } else {
    orbitControls.enabled = true;
  }

  if (event.ctrlKey && event.button === 0) {
    if (!isEditMode) return;
    isSelecting = true;
    skipNextClick = true;
    selectionStart = { x: event.clientX, y: event.clientY };
    updateSelectionBox(event.clientX, event.clientY);
    selectionBox.style.display = 'block';

    orbitControls.enabled = false;
  }
});

window.addEventListener('mousemove', (e) => {
  if (isSelecting) {
    updateSelectionBox(e.clientX, e.clientY);
  }
  (function attachCornerEditMoveOnce() {
    if (attachCornerEditMoveOnce._done) return;
    attachCornerEditMoveOnce._done = true;

    window.addEventListener('mousemove', (e) => {
      if (!activeLineEdit) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, intersectPoint)) return;

      const { group, index } = activeLineEdit;
      group.traverse(obj => {
        if (obj.isMesh && obj.geometry?.type === "CircleGeometry") {
          // thetaLength가 PI면 반원, 2PI면 전체 원
          if ((obj.geometry.parameters?.thetaLength ?? Math.PI * 2) === Math.PI) {
            obj.visible = false;   // 반원은 숨김
          }
        }
      });

      // 스냅 없이 자유 이동
      const local = new THREE.Vector3(intersectPoint.x, group.position.y, intersectPoint.z);
      group.worldToLocal(local);
      group.userData.points[index].copy(local);

      // 세그먼트 2개만 갱신
      const pts = group.userData.points;
      const N = pts.length;
      const thickness = group.userData.width ?? group.userData.thickness ?? 20;
      const prevA = (index - 1 + N) % N;
      const prevB = index;
      const nextA = index;
      const nextB = (index + 1) % N;

      if (index > 0 || activeLineEdit.isClosed) updateSegMesh(group, prevA, prevB, thickness);
      if (index < N - 1 || activeLineEdit.isClosed) updateSegMesh(group, nextA, nextB, thickness);

      // 코너 마커도 이동
      if (activeLineEdit?.marker) {
        const Y = group.userData?.Y ?? pts[0].y ?? -5;
        activeLineEdit.marker.position.set(pts[index].x, Y, pts[index].z);
      }
      if (activeLineEdit) return;
    }, { passive: false });
  })();


  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((e.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (raycaster.ray.intersectPlane(floorPlane, intersectPoint)) {
    if (previewRack && currentPreviewMode) {
      previewRack.position.set(intersectPoint.x, 0, intersectPoint.z);
      if (!scene.children.includes(previewRack)) {
        scene.add(previewRack);
      }
      const overlap = isTooMuchOverlap(previewRack);
      const outOf = isOutOfGridBounds(getAccurateRackBoundingBox(previewRack));

      const res = findStackTargetAndY(previewRack);
      if (res.ok) {
        // 쌓기 미리보기
        previewSnapLock.locked = true;
        previewSnapLock.target = res.target;
        previewSnapLock.y = res.y;
        previewRack.position.set(res.target.position.x, res.y, res.target.position.z);
        previewRack.rotation.y = res.target.rotation.y;
        previewRack.userData._hoverStackOK = true;
        previewRack.userData._hoverStackTarget = res.target;
        previewRack.userData._hoverStackY = res.y;
      } else {
        previewSnapLock.locked = false;
        previewSnapLock.target = null;
        previewSnapLock.y = 0;
        previewRack.userData._hoverStackOK = false;
        previewRack.userData._hoverStackTarget = null;
        previewRack.userData._hoverStackY = null;
      }

      // 가능/불가 시각 피드백: 재질 투명도만 조정
      const bad = overlap || outOf;
      previewRack.traverse(o => {
        if (o.isMesh && o.material && 'opacity' in o.material) {
          o.material.opacity = bad ? 0.2 : (res.ok ? 0.6 : 0.3);
        }
      });
    }

    // 라인 그리기 모드에서 선 미리보기
    if (activeLineEdit) {
      if (previewLine) { scene.remove(previewLine); previewLine = null; }
    } else if (isLineDrawingMode && lastLinePoint) {
      const { x, z } = clampToGridBoundsUnified(intersectPoint.x, intersectPoint.z);
      const tempPoint = new THREE.Vector3(x, -5, z);

      if (previewLine) { scene.remove(previewLine); previewLine = null; }

      // 현재까지 누적한 점 + 임시 점으로 미리보기
      const pts = activePolylinePoints.length
        ? [...activePolylinePoints, tempPoint]
        : [lastLinePoint, tempPoint];

      previewLine = createThickMarkingLine(pts, 0xfff000, 20);
      scene.add(previewLine);
    }
    {
      // 모든 영역선과 랙/파레트 엣지 포함해서 커서 상태 결정
      const allMarkingObjects = markingLines.flatMap(group => {
        const objs = [];
        group.traverse(obj => { if (obj.isMesh) objs.push(obj); });
        return objs;
      });
      const allEdges = rackGroups.map(g => g.userData.edge).filter(Boolean);

      const intersectsLines = raycaster.intersectObjects(allMarkingObjects, true);
      const intersectsEdges = raycaster.intersectObjects(allEdges, true);

      if (isLineDrawingMode || activeLineEdit) {
        // 영역선 작업 중이면 항상 십자
        renderer.domElement.style.cursor = 'crosshair';
      } else if (intersectsLines.length > 0 || intersectsEdges.length > 0) {
        // 영역선/랙/파레트 엣지 위에 마우스 있으면 pointer
        renderer.domElement.style.cursor = 'pointer';
      } else {
        // 기본값
        renderer.domElement.style.cursor = 'default';
      }
    }
  }
});

window.addEventListener('mouseup', (event) => {
  if (event.button === 2) return;

  // 코너 드래그 종료 처리 (라인 편집)
  (function attachCornerEditEndOnce() {
    if (attachCornerEditEndOnce._done) return;
    attachCornerEditEndOnce._done = true;

    window.addEventListener('mouseup', () => {
      if (!activeLineEdit) return;

      const { group, index, prevPoint } = activeLineEdit;
      const color = group.userData.color ?? 0xffcc00;
      const thickness = group.userData.width ?? group.userData.thickness ?? 20;
      const wasClosed = group.userData.segments.some(s => {
        const N = group.userData.points.length;
        return (s.a === 0 && s.b === N - 1) || (s.a === N - 1 && s.b === 0);
      });

      // 현재 코너의 월드 좌표
      const world = group.localToWorld(group.userData.points[index].clone());

      // 바운드 체크
      const gridX = floorOffsetX - gridWidth / 2;
      const gridZ = floorOffsetZ - gridDepth / 2;
      const gridMaxX = floorOffsetX + gridWidth / 2;
      const gridMaxZ = floorOffsetZ + gridDepth / 2;

      const outOfBounds =
        world.x < gridX || world.x > gridMaxX ||
        world.z < gridZ || world.z > gridMaxZ;

      if (outOfBounds) {
        group.userData.points[index].copy(prevPoint);
      }

      // 모든 포인트를 그리드에 맞게 스냅
      const snappedWorldPoints = group.userData.points.map(p => {
        const world = group.localToWorld(p.clone());
        const snapped = clampToGridBoundsUnified(world.x, world.z);
        return new THREE.Vector3(snapped.x, world.y, snapped.z);
      });

      // 기존 그룹 제거/메모리 해제
      scene.remove(group);
      disposeObject(group);
      const idx = markingLines.indexOf(group);
      if (idx !== -1) markingLines.splice(idx, 1);

      // 새 라인 생성
      const ptsForCreate = wasClosed
        ? [...snappedWorldPoints, snappedWorldPoints[0].clone()]
        : snappedWorldPoints;
      const newGroup = createThickMarkingLine(ptsForCreate, color, thickness);
      scene.add(newGroup);
      markingLines.push(newGroup);

      // 선택 상태 갱신
      selectedMarkingLine = newGroup;
      selectedMarkingLines = [newGroup];

      activeLineEdit = null;

      // 카메라/휠 인터랙션 복원
      if (_savedOrbitState) {
        orbitControls.enabled = _savedOrbitState.enabled;
        orbitControls.enablePan = _savedOrbitState.enablePan;
        orbitControls.enableRotate = _savedOrbitState.enableRotate;
        orbitControls.enableZoom = _savedOrbitState.enableZoom;
        _savedOrbitState = null;
      }
      if (_lineDragWheelBlocker) {
        renderer.domElement.removeEventListener('wheel', _lineDragWheelBlocker);
        _lineDragWheelBlocker = null;
      }
      gridHelper.visible = false;
    });
  })();

  // 생성 모드 처리 (랙/파레트)
  if (event.button === 0 && currentPreviewMode && previewRack) {
    const bounds = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const floorHits = floorMesh ? raycaster.intersectObject(floorMesh) : [];
    if (floorHits.length === 0) return;

    const { cols, floors, depth, cellW: localCellW } = previewRack.userData;
    const { offsetX, offsetZ } = getOffsetFromGroup(previewRack);
    const { x: clampedX, z: clampedZ } = clampToGridBoundsUnified(
      previewRack.position.x, previewRack.position.z, offsetX, offsetZ
    );
    const rotY = previewRack.rotation.y;

    // 임시 그룹으로 충돌/바운드 검사
    const testRack = (previewRack.userData.type === 'pallet')
      ? createPalletRack(clampedX, clampedZ, cols, Math.round(depth / cellD), false)
      : createRealisticShelf(clampedX, clampedZ, cols, floors, depth, localCellW, false);

    testRack.rotation.y = rotY;
    testRack.updateMatrixWorld(true);
    scene.add(testRack);

    let overlap = isTooMuchOverlap(testRack);
    let outOfBounds = isOutOfGridBounds(getAccurateRackBoundingBox(testRack));

    scene.remove(testRack);
    safeRemoveEdge(testRack.userData?.edge);

    // 조건 분기
    if (previewSnapLock.locked && previewSnapLock.target) {
      // === 스택 모드 ===
      if (outOfBounds) {
        alert('바닥 영역을 벗어났습니다.');
        return;
      }
      overlap = false; // 스택 모드는 겹침 무시
    } else {
      // 일반 모드
      if (overlap) {
        alert('해당 위치에는 이미 다른 랙/파레트가 있습니다.');
        return;
      }
      if (outOfBounds) {
        alert('바닥 영역을 벗어났습니다.');
        return;
      }
    }

    // 실제 그룹 생성
    const realRack = (previewRack.userData.type === 'pallet')
      ? createPalletRack(clampedX, clampedZ, cols, Math.round(depth / cellD), true)
      : createRealisticShelf(clampedX, clampedZ, cols, floors, depth, localCellW, true);

    if (previewSnapLock.locked && previewSnapLock.target) {
      // 대상 위에 정확히 올림
      realRack.position.set(
        previewSnapLock.target.position.x,
        previewSnapLock.target.position.y + 15 + (previewSnapLock.target.userData.floors * cellH),
        previewSnapLock.target.position.z
      );
      realRack.rotation.y = previewSnapLock.target.rotation.y;
      linkStackRelation(realRack, previewSnapLock.target);
    } else {
      // 바닥 배치
      realRack.rotation.y = rotY;
      realRack.position.set(clampedX, 0, clampedZ);
    }

    // 풀 업데이트
    if (realRack.userData.type === 'rack') updateRackFromEdge(realRack);
    else updatePalletTransform(realRack, realRack.position.clone(), realRack.rotation.y);

    scene.add(realRack);
    rackGroups.push(realRack);
    dragHandles.push(realRack.userData.edge);
    if (dragControls) {
      const objs = dragControls.getObjects();
      if (!objs.includes(realRack.userData.edge)) objs.push(realRack.userData.edge);
    }

    // 미리보기 유지
    if (currentPreviewMode) {
      showPreview(currentPreviewMode);
      requestAnimationFrame(() => {
        const el = renderer && renderer.domElement ? renderer.domElement : canvas;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = (typeof lastMouseX === 'number') ? lastMouseX : rect.left + rect.width / 2;
        const y = (typeof lastMouseY === 'number') ? lastMouseY : rect.top + rect.height / 2;
        el.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      });
    }
  }

  // 드래그 박스 선택 종료
  if (isSelecting) {
    isSelecting = false;
    selectionBox.style.display = 'none';

    const rect = renderer.domElement.getBoundingClientRect();
    const p1 = new THREE.Vector2(
      ((selectionStart.x - rect.left) / rect.width) * 2 - 1,
      -((selectionStart.y - rect.top) / rect.height) * 2 + 1
    );
    const p2 = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const frustumMin = new THREE.Vector2(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y));
    const frustumMax = new THREE.Vector2(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));

    const _tempBox = new THREE.Box3();
    const _tempVec3 = new THREE.Vector3();

    // 랙 검사 (기본 중심점 기준)
    selectedRackGroups = rackGroups.filter(group => {
      _tempBox.setFromObject(group);
      const center = _tempBox.getCenter(_tempVec3);
      const projected = center.project(camera);
      return (
        projected.x >= frustumMin.x && projected.x <= frustumMax.x &&
        projected.y >= frustumMin.y && projected.y <= frustumMax.y
      );
    });

    // edge 비활성화
    rackGroups.forEach(g => { if (g.userData.edge) g.userData.edge.visible = false; });

    if (selectedRackGroups.length > 1 || (event.ctrlKey && selectedRackGroups.length >= 1)) {
      // Ctrl 드래그 영역 → 무조건 multiSelectEdge
      updateMultiSelectEdge();
      selectedGroup = selectedRackGroups[0];
      gridHelper.visible = true;

    } else if (selectedRackGroups.length === 1) {
      // 단순 클릭/드래그로 하나만 선택된 경우에만 개별 edge 켜기
      const main = selectedRackGroups[0];
      if (main.userData.edge) main.userData.edge.visible = true;
      if (multiSelectEdge) {
        scene.remove(multiSelectEdge);
        disposeObject(multiSelectEdge);
        multiSelectEdge = null;
      }
      isSelected = true;

    } else {
      if (multiSelectEdge) {
        scene.remove(multiSelectEdge);
        disposeObject(multiSelectEdge);
        multiSelectEdge = null;
      }

      // 아무것도 없으면 선택 해제
      isSelected = false;
    }

    // 라인 검사 (기존 로직 그대로 유지)
    selectedMarkingLines = markingLines.filter(line => {
      _tempBox.setFromObject(line);
      const center = _tempBox.getCenter(_tempVec3);
      const projected = center.project(camera);
      return (
        projected.x >= frustumMin.x && projected.x <= frustumMax.x &&
        projected.y >= frustumMin.y && projected.y <= frustumMax.y
      );
    });

    markingLines.forEach(lineGroup => {
      lineGroup.traverse(obj => {
        if (obj.isMesh && obj.material?.color) obj.material.color.set(0xffcc00);
      });
    });

    if (selectedRackGroups.length > 0) {
      selectedMarkingLine = null;
      selectedMarkingLines = [];
    } else if (selectedMarkingLines.length > 0) {
      selectedMarkingLines.forEach(lineGroup => {
        lineGroup.traverse(obj => {
          if (obj.isMesh && obj.material?.color) obj.material.color.set(0xff6600);
        });
      });
    }
    orbitControls.enabled = true;
    return;
  }
  if (!activeDragGroup) {
    orbitControls.enabled = true;
  }
});


// 레이아웃 브라우저 조절
window.addEventListener('resize', () => {
  renderer.setSize(container.clientWidth, container.clientHeight);
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
});


document.addEventListener('keydown', (event) => {
  if (!selectedGroup || !isEditMode) return;

  const key = event.key;
  const isArrow = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(key);
  const isDepth = key === '[' || key === ']';
  if (!isArrow && !isDepth) return;

  if (selectedGroup.userData.isReadOnly) return;
  if (selectedGroup.userData.stackAbove?.length > 0) return;

  const isVerticalResize = key === 'ArrowUp' || key === 'ArrowDown';
  if (selectedGroup.userData.stackBelow && !isVerticalResize) return;

  const type = selectedGroup.userData.type;
  const rotY = selectedGroup.rotation.y;
  const isRotated = Math.abs(rotY % Math.PI - Math.PI / 2) < 0.01;
  const cellW = selectedGroup.userData.cellW || 100;

  const oldCols = selectedGroup.userData.cols ?? 2;
  const oldFloors = selectedGroup.userData.floors ?? 1;
  const oldDepth = selectedGroup.userData.depth ?? cellD * 2;
  const oldDepthSlots = Math.round(oldDepth / cellD);

  let newCols = oldCols;
  let newFloors = oldFloors;
  let newDepthSlots = oldDepthSlots;

  if (type === 'rack') {
    if (key === 'ArrowRight') newCols += 1;
    if (key === 'ArrowLeft') newCols = Math.max(1, newCols - 1);
    if (key === 'ArrowUp') newFloors += 1;
    if (key === 'ArrowDown') newFloors = Math.max(1, newFloors - 1);
    if (key === ']') newDepthSlots += 1;
    if (key === '[') newDepthSlots = Math.max(1, newDepthSlots - 1);
  } else if (type === 'pallet') {
    if (key === 'ArrowRight') newCols += 1;
    if (key === 'ArrowLeft') newCols = Math.max(1, newCols - 1);
    if (key === ']') newDepthSlots += 1;
    if (key === '[') newDepthSlots = Math.max(1, newDepthSlots - 1);
    newFloors = 1;
  }

  const newW = newCols * cellW;
  const newD = newDepthSlots * cellD;
  const oldW = oldCols * cellW;
  const oldD = oldDepth;

  const centerX = selectedGroup.position.x;
  const centerZ = selectedGroup.position.z;

  let newX, newZ;
  if (isRotated) {
    const fixedX = centerX + oldD / 2;
    const fixedZ = centerZ - oldW / 2;
    newX = fixedX - newD / 2;
    newZ = fixedZ + newW / 2;
  } else {
    const fixedX = centerX - oldW / 2;
    const fixedZ = centerZ + oldD / 2;
    newX = fixedX + newW / 2;
    newZ = fixedZ - newD / 2;
  }

  // 충돌 체크용 임시 group
  const testGroup = (type === 'pallet')
    ? createPalletRack(0, 0, newCols, newDepthSlots, false)
    : createRealisticShelf(0, 0, newCols, newFloors, newD, cellW, false);

  testGroup.rotation.y = rotY;
  testGroup.position.set(newX, selectedGroup.position.y, newZ);
  scene.add(testGroup);
  testGroup.updateMatrixWorld(true);

  const overlap = isTooMuchOverlap(testGroup, selectedGroup);
  const outOfBounds = isOutOfGridBounds(getAccurateRackBoundingBox(testGroup));

  // 더미 제거 (공통 처리)
  scene.remove(testGroup);
  safeRemoveEdge(testGroup.userData?.edge);
  disposeObject(testGroup);

  if (overlap || outOfBounds) return;

  // 기존 group 제거
  if (type === 'rack') {
    removeRackInstance(selectedGroup);
  } else if (type === 'pallet') {
    removePalletInstance(selectedGroup);
  }
  safeRemoveEdge(selectedGroup.userData.edge);
  scene.remove(selectedGroup);
  const idx = rackGroups.indexOf(selectedGroup);
  if (idx !== -1) rackGroups.splice(idx, 1);

  // 새 group 생성
  const newGroup = (type === 'pallet')
    ? createPalletRack(0, 0, newCols, newDepthSlots, true)
    : createRealisticShelf(0, 0, newCols, newFloors, newD, cellW, true);

  newGroup.rotation.y = rotY;
  newGroup.position.set(newX, selectedGroup.position.y, newZ);
  newGroup.updateMatrixWorld(true);

  const edge = newGroup.userData.edge;
  if (!dragHandles.includes(edge)) dragHandles.push(edge);
  if (dragControls) {
    const objs = dragControls.getObjects();
    if (!objs.includes(edge)) objs.push(edge);
  }

  Object.assign(newGroup.userData, {
    stackBelow: selectedGroup.userData.stackBelow,
    stackAbove: selectedGroup.userData.stackAbove,
    isStackable: selectedGroup.userData.isStackable,
    type: type
  });

  selectedGroup = newGroup;
  rackGroups.push(newGroup);
  edge.visible = true;

  // InstancedMesh 업데이트
  if (type === 'rack') {
    updateRackFromEdge(newGroup);
  } else if (type === 'pallet') {
    updatePalletTransform(newGroup, newGroup.position.clone(), newGroup.rotation.y);
  }

  gridHelper.visible = isEditMode;
});

// 단축키(쌓기, 회전, 삭제)
document.addEventListener('keydown', (event) => {
  if (!selectedGroup) return;
  if (event.key === 'r' || event.key === 'R') {
    if (!isEditMode) return;
    if (selectedGroup.userData.stackAbove?.length > 0) return;
    if (selectedGroup.userData.stackBelow) return;

    const fixedY = selectedGroup.position.y;
    const rotY = selectedGroup.rotation.y + Math.PI / 2;

    // 테스트 그룹 (풀 등록 안 함)
    const testGroup = (selectedGroup.userData.type === 'pallet')
      ? createPalletRack(0, 0, selectedGroup.userData.cols, Math.round(selectedGroup.userData.depth / cellD), false)
      : createRealisticShelf(0, 0, selectedGroup.userData.cols, selectedGroup.userData.floors, selectedGroup.userData.depth, selectedGroup.userData.cellW, false);

    testGroup.rotation.y = rotY;
    testGroup.position.set(selectedGroup.position.x, fixedY, selectedGroup.position.z);
    scene.add(testGroup);
    testGroup.updateMatrixWorld(true);

    const overlap = isTooMuchOverlap(testGroup, selectedGroup);
    const outOfBounds = isOutOfGridBounds(getAccurateRackBoundingBox(testGroup));

    scene.remove(testGroup);
    safeRemoveEdge(testGroup.userData?.edge);

    if (overlap || outOfBounds) {
      alert('해당 위치에서 회전할 수 없습니다.');
      return;
    }

    // 실제 회전 적용
    selectedGroup.rotation.y = rotY;
    selectedGroup.updateMatrixWorld(true);

    // 스냅 보정
    const { offsetX, offsetZ } = getOffsetFromGroup(selectedGroup);
    const snapCenter = clampToGridBoundsUnified(
      selectedGroup.position.x,
      selectedGroup.position.z,
      offsetX,
      offsetZ
    );
    selectedGroup.position.set(snapCenter.x, fixedY, snapCenter.z);
    selectedGroup.updateMatrixWorld(true);

    // 풀 업데이트
    if (selectedGroup.userData.type === 'rack') {
      updateRackFromEdge(selectedGroup);
    } else if (selectedGroup.userData.type === 'pallet') {
      updatePalletTransform(selectedGroup, selectedGroup.position.clone(), selectedGroup.rotation.y);
    }
  }


  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault(); // 입력창 포커스가 있을 때도 동작하게
    deleteSelectedRack();
  }
  if (event.key === 'Control') {
    orbitControls.enabled = false;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedMarkingLine) {
      scene.remove(selectedMarkingLine);
      markingLines = markingLines.filter(l => l !== selectedMarkingLine);
      selectedMarkingLine = null;
    }
    if (selectedMarkingLines.length > 0) {
      selectedMarkingLines.forEach(group => scene.remove(group));
      markingLines = markingLines.filter(g => !selectedMarkingLines.includes(g));
      selectedMarkingLines = [];
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (!isEditMode) return;
  if (e.ctrlKey && e.key === 'c') {
    e.preventDefault();
    copySelectedRacks();
  }

  if (e.ctrlKey && e.key === 'v') {
    e.preventDefault();
    pasteCopiedRacks();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 's' || e.key === 'S') {
    if (currentPreviewMode) {
      currentPreviewMode = null;
      removePreviewRack();
    }
    if (isLineDrawingMode) {
      isLineDrawingMode = false;
      lastLinePoint = null;
      if (previewLine) {
        scene.remove(previewLine);
        previewLine = null;
      }
      gridHelper.visible = false;
    }
    gridHelper.visible = false;
  }
});

document.addEventListener('keyup', (event) => {
  if (!isEditMode) return;
  if (event.key === 'Control') {
    orbitControls.enabled = true;
  }
});


// 생성 모드 누르면: canvas에만 보여주기
document.querySelectorAll('.btn-type').forEach(btn => {
  btn.onclick = () => {
    // 모든 버튼 비활성화 후 현재 버튼 활성화
    document.querySelectorAll('.btn-type').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const type = btn.dataset.type;

    if (type === 'rack') {
      document.getElementById('rack-options').style.display = 'block';
      renderMiniPreview('rack'); // ← 라디오 대신 cellW 입력값 기반으로
    } else {
      document.getElementById('rack-options').style.display = 'none';
      renderMiniPreview('pallet');
    }
  };
});

['rack-cols', 'rack-floors', 'rack-depth', 'rack-cellw'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const activeType = document.querySelector('.btn-type.active')?.dataset.type;
    if (activeType) {
      renderMiniPreview(activeType);
    }
  });
});

document.getElementById('rack-cellw').addEventListener('input', () => {
  const activeType = document.querySelector('.btn-type.active')?.dataset.type;
  if (activeType === 'rack') {
    renderMiniPreview('rack');
  }
});

// 확정 버튼 누르면: 마우스 따라다니는 미리보기 시작
document.getElementById('btn-create-rack').onclick = () => {
  const activeType = document.querySelector('.btn-type.active')?.dataset.type;
  if (!activeType) return;

  // 다른 모드 끄기
  if (isLineDrawingMode) {
    isLineDrawingMode = false;
    lastLinePoint = null;
    activePolyline = null;
    activePolylinePoints = [];
    if (previewLine) {
      scene.remove(previewLine);
      previewLine = null;
    }
    gridHelper.visible = false;
  }
  gridHelper.visible = true;

  // 이미 생성 모드일 때 다시 버튼 누르면 종료
  if (currentPreviewMode && previewRack) {
    removePreviewRack();
    currentPreviewMode = null;
    lastLinePoint = null;
    gridHelper.visible = false;
    return;
  }

  showPreview(activeType);
};

// 박스 추가 버튼
document.getElementById('btn-box').onclick = () => {
  if (selectedGroup) {
    addBoxToFirstEmptySlot(selectedGroup);
    selectedGroup.userData.edge.visible = true;
    orbitControls.enabled = true;
  } else {
    alert('먼저 랙이나 파레트를 클릭해서 선택해주세요!');
  }
};

document.getElementById('btn-delete').onclick = () => {
  deleteSelectedRack();
};


document.getElementById('btn-draw-line').onclick = () => {
  // 다른 모드 끄기
  if (currentPreviewMode && previewRack) {
    removePreviewRack();
    currentPreviewMode = null;
  }

  isLineDrawingMode = !isLineDrawingMode;
  lastLinePoint = null;
  activePolyline = null;
  activePolylinePoints = [];

  if (isLineDrawingMode) {
    gridHelper.visible = true;
  } else {
    if (previewLine) {
      scene.remove(previewLine);
      previewLine = null;
    }
    gridHelper.visible = false;
  }
};
document.getElementById('preview-canvas').addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = Math.sign(e.deltaY);

  // 줌 범위 제한 (너무 작거나 너무 커지지 않도록)
  previewZoom *= delta > 0 ? 1.1 : 0.9;
  previewZoom = Math.max(0.3, Math.min(3.0, previewZoom));

  // 다시 미리보기 렌더링
  const activeType = document.querySelector('.btn-type.active')?.dataset.type;
  if (activeType) {
    renderMiniPreview(activeType); // 줌 반영됨
  }
});
const previewCanvasEl = document.getElementById('preview-canvas');

// 왼쪽 클릭으로 회전 시작
previewCanvasEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // 왼쪽 버튼만
  isDraggingPreview = true;
  lastPreviewX = e.clientX;
});

// 드래그 중 회전
window.addEventListener('mousemove', (e) => {
  if (!isDraggingPreview) return;

  const deltaX = e.clientX - lastPreviewX;
  lastPreviewX = e.clientX;

  previewCameraAngle -= deltaX * 0.005;

  const type = document.querySelector('.btn-type.active')?.dataset.type;
  if (type) renderMiniPreview(type);
});

// 마우스 떼면 회전 종료
window.addEventListener('mouseup', () => {
  isDraggingPreview = false;
});

document.getElementById('btn-save').onclick = saveScene;
document.getElementById('btn-load').onclick = loadScene;

document.getElementById('btn-grow-custom').onclick = () => {
  const panel = document.getElementById('floor-grow-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

document.getElementById('apply-grow-btn').onclick = () => {
  const x = parseInt(document.getElementById('input-grow-x').value) || 0;
  const z = parseInt(document.getElementById('input-grow-z').value) || 0;
  const dx = parseInt(document.getElementById('dir-grow-x').value);
  const dz = parseInt(document.getElementById('dir-grow-z').value);

  const nextW = gridWidth + x * cellW;
  const nextD = gridDepth + z * cellD;

  updateGridAndFloorXY(nextW, nextD, { x: dx, z: dz });
};

document.getElementById('toggle-readonly-btn').onclick = () => {
  isEditMode = !isEditMode;
  isBoxSelectMode = !isEditMode;

  // 선택된 박스 하이라이트 제거
  if (selectedBox) {
    selectedBox.material.emissive?.set(0x000000);
    selectedBox = null;
  }

  gridHelper.visible = isEditMode;

  // 기타 스타일 업데이트
  rackGroups.forEach(group => {
    const edge = group.userData.edge;
    if (Array.isArray(edge.material)) {
      edge.material.forEach(m => {
        m.color.set(isEditMode ? 0xff0000 : 0x84eb89);
        m.opacity = isEditMode ? 0.3 : 0.3;
      });
    } else {
      edge.material.color.set(isEditMode ? 0xff0000 : 0x84eb89);
      edge.material.opacity = isEditMode ? 0.3 : 0.3;
    }
  });

  // 드래그 핸들 갱신
  dragHandles.length = 0;
  if (isEditMode) {
    rackGroups.forEach(g => {
      if (g.userData.edge) dragHandles.push(g.userData.edge);
    });
  }

  document.getElementById('toggle-readonly-btn').innerText =
    isEditMode ? '읽기전용 ON' : '읽기전용 OFF';

  if (dragControls) dragControls.dispose();
  dragControls = new DragControls(dragHandles, camera, renderer.domElement);
  dragControls.transformGroup = false;
  enableDrag();

  alert(`읽기전용: ${!isEditMode ? 'ON' : 'OFF'}`);
};

document.getElementById('btn-help').onclick = () => {
  alert(
    [
      '[ 단축키 도움말 ]',
      '',
      'R                         → 랙 회전 (90도)',
      '[ / ]                     → 두께 줄이기 / 늘리기',
      '← / →                 → 가로 칸 수 변경',
      '↑ / ↓                    → 층 수 변경',
      '마우스 드래그     → 랙 이동',
      'S                         → 생성 중지',
      'backspace           → 랙 삭제',
      'Ctrl + 드래그      → 랙 다중 선택',
      'Ctrl +C,V            → 지정 랙 복사, 붙여넣기',
      '',
      '※ 박스 추가는 "박스 추가" 버튼 사용'
    ].join('\n')
  );
};

document.getElementById('btn-camera-menu').onclick = () => {
  const options = document.getElementById('camera-options');
  options.style.display = options.style.display === 'none' ? 'block' : 'none';
};

document.querySelectorAll('#camera-options button').forEach(btn => {
  btn.onclick = () => {
    const view = btn.dataset.view;
    setCameraView(view);
  };
});

document.getElementById('btn-exit-view').onclick = restoreOriginalCameraState;

// 저장
function saveScene() {
  const rackData = rackGroups.map(group => {
    const boxes = group.children.filter(obj => obj.userData.fromSlot);
    const boxSlots = [];
    if (group.userData.boxMesh) {
      group.userData.slots.forEach(slot => {
        if (slot.occupied && slot.instanceIndex !== undefined) {
          boxSlots.push({
            floor: slot.floor,
            col: slot.col,
            depthIndex: slot.depthIndex,
            color: group.userData.boxMesh.material.color.getHex()
          });
        }
      });
    }

    return {
      type: group.userData.type,
      position: { x: group.position.x, y: group.position.y, z: group.position.z },
      rotationY: group.rotation.y,
      cols: group.userData.cols,
      floors: group.userData.floors,
      depthUnits: group.userData.depthUnits,
      depth: group.userData.depth,
      cellW: group.userData.cellW,
      boxes: boxSlots
    };
  });

  const markingData = markingLines.map(line =>
    line.userData.points.map(p => ({ x: p.x, y: p.y, z: p.z }))
  );

  const sceneData = {
    floor: {
      width: gridWidth,
      depth: gridDepth,
      offsetX: floorOffsetX,
      offsetZ: floorOffsetZ,
      markings: markingData
    },
    racks: rackData,
  };
  console.log('saveScene:', sceneData);

  localStorage.setItem('savedRacks', JSON.stringify(sceneData));
}

document.getElementById('btn-toggle-perf').onclick = () => {
  isPerfVisible = !isPerfVisible;
  perfBox.style.display = isPerfVisible ? 'block' : 'none';
};

// 불러오기
function loadScene() {
  const data = JSON.parse(localStorage.getItem('savedRacks') || '{}');
  if (!data || !data.floor || !Array.isArray(data.racks)) return;

  // 기존 씬 초기화
  rackGroups.forEach(g => {
    scene.remove(g);
    safeRemoveEdge(g.userData?.edge);
    disposeObject(g);
  });
  rackGroups.length = 0;

  // dragHandles 제거
  dragHandles.forEach(h => {
    scene.remove(h);
    disposeObject(h);
  });
  dragHandles.length = 0;

  // 멀티 선택 엣지 제거
  if (multiSelectEdge) {
    scene.remove(multiSelectEdge);
    disposeObject(multiSelectEdge);
    multiSelectEdge = null;
  }

  // 영역선 제거
  markingLines.forEach(line => {
    scene.remove(line);
    disposeObject(line);
  });
  markingLines.length = 0;

  // InstancedMesh 풀 리셋
  for (let key in rackPools) {
    rackPools[key].count = 0;
    rackPools[key].instanceMatrix.needsUpdate = true;
  }
  for (let key in palletPools) {
    palletPools[key].count = 0;
    palletPools[key].instanceMatrix.needsUpdate = true;
  }

  // 이후 floor/grid/racks 복원
  updateGridAndFloorXY(data.floor.width, data.floor.depth, { x: 0, z: 0 });
  floorOffsetX = data.floor.offsetX;
  floorOffsetZ = data.floor.offsetZ;

  gridHelper.position.set(floorOffsetX, -20, floorOffsetZ);
  if (floorMesh) floorMesh.position.set(floorOffsetX, -26, floorOffsetZ);

  // 랙/파레트 복원
  data.racks.forEach(rack => {
    const { type, position, rotationY, cols, floors, depthUnits, depth, cellW, boxes } = rack;
    const finalDepth = depth ?? ((depthUnits ?? 1) * cellD);

    const group = (type === 'pallet')
      ? createPalletRack(0, 0, cols, Math.round(finalDepth / cellD), true)
      : createRealisticShelf(0, 0, cols, floors, finalDepth, cellW, true);

    group.rotation.y = rotationY;
    group.position.set(position.x, position.y, position.z);
    group.updateMatrixWorld(true);

    if (type === 'rack') updateRackFromEdge(group);
    else updatePalletTransform(group, group.position.clone(), group.rotation.y);

    rackGroups.push(group);
    dragHandles.push(group.userData.edge);
    scene.add(group);

    // 박스 복원
    boxes?.forEach(boxData => {
      const slot = group.userData.slots.find(s =>
        s.floor === boxData.floor &&
        s.col === boxData.col &&
        s.depthIndex === boxData.depthIndex &&
        !s.occupied
      );
      if (slot) {
        addBoxToFirstEmptySlot(group);
        if (group.userData.boxMesh) {
          const idx = slot.instanceIndex;
          group.userData.boxMesh.setColorAt(idx, new THREE.Color(boxData.color));
          group.userData.boxMesh.instanceColor.needsUpdate = true;
        }
      }
    });
  });

  // 영역선 복원
  (data.floor?.markings ?? []).forEach(points => {
    const vecPoints = points.map(p => new THREE.Vector3(p.x, p.y ?? -5, p.z));
    if (vecPoints.length >= 3) {
      const first = vecPoints[0];
      const last = vecPoints[vecPoints.length - 1];
      if (first.distanceTo(last) > 0.01) vecPoints.push(first.clone());
    }
    const line = createThickMarkingLine(vecPoints);
    scene.add(line);
    markingLines.push(line);
  });
}


// 카메라 이동 전 초기위치 저장
function saveOriginalCameraStateIfNeeded() {
  if (!isCameraChanged) {
    originalCameraState = {
      position: camera.position.clone(),
      target: orbitControls.target.clone()
    };
    isCameraChanged = true;
  }
}

// 카메라 위치 이동후 제자리로
function restoreOriginalCameraState() {
  if (originalCameraState) {
    camera.position.copy(originalCameraState.position);
    orbitControls.target.copy(originalCameraState.target);
    orbitControls.update();
  }
  isCameraChanged = false;
  document.getElementById('btn-exit-view').style.display = 'none';
}


// 카메라 위치 지정
function setCameraView(view) {
  saveOriginalCameraStateIfNeeded();

  switch (view) {
    case 'top': camera.position.set(0, 5000, 0); break;
    case 'front': camera.position.set(0, 500, 5000); break;
    case 'back': camera.position.set(0, 500, -5000); break;
    case 'left': camera.position.set(-5200, 500, 0); break;
    case 'right': camera.position.set(5200, 500, 0); break;
  }

  camera.lookAt(0, 0, 0);
  orbitControls.target.set(0, 0, 0);
  orbitControls.update();
  document.getElementById('btn-exit-view').style.display = 'block';
}

enableDrag();

function animatePreview() {
  requestAnimationFrame(animatePreview);
  previewRenderer.render(previewScene, previewCamera);
}
animatePreview();

(function animate() {
  requestAnimationFrame(animate);

  // orbitControls target이 바닥 밑으로 내려가지 않게 보정
  if (orbitControls.target.y < 0) {
    orbitControls.target.y = 0;
  }


  // 카메라 최대 거리 조절
  orbitControls.maxDistance = Math.max(gridWidth, gridDepth) * 1.2;

  // 카메라 이동 영역 제한
  const minX = floorOffsetX - gridWidth / 2;
  const maxX = floorOffsetX + gridWidth / 2;
  const minZ = floorOffsetZ - gridDepth / 2;
  const maxZ = floorOffsetZ + gridDepth / 2;

  // X 제한
  if (orbitControls.target.x < minX) {
    const dx = minX - orbitControls.target.x;
    orbitControls.target.x = minX;
    camera.position.x += dx; // 카메라도 같이 이동시켜 어긋남 방지
  }
  if (orbitControls.target.x > maxX) {
    const dx = orbitControls.target.x - maxX;
    orbitControls.target.x = maxX;
    camera.position.x -= dx;
  }

  // Z 제한
  if (orbitControls.target.z < minZ) {
    const dz = minZ - orbitControls.target.z;
    orbitControls.target.z = minZ;
    camera.position.z += dz;
  }
  if (orbitControls.target.z > maxZ) {
    const dz = orbitControls.target.z - maxZ;
    orbitControls.target.z = maxZ;
    camera.position.z -= dz;
  }

  // 바닥 크기에 따라 동적으로 높이 기준 설정
  const baseSize = Math.max(gridWidth, gridDepth);
  const limitHeight = baseSize * 0.4;

  if (camera.position.y > limitHeight) {
    // 바닥에서 멀면 위/아래 pan 막기
    orbitControls.target.y = 0;
    camera.position.y = Math.max(camera.position.y, limitHeight);
  }

  // 카메라 프러스텀 준비
  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);

  // 인스턴스 풀 갱신
  for (const key in rackPools) {
    const pool = rackPools[key];
    let visibleCount = 0;
    rackGroups.forEach(g => {
      if (g.userData.poolKey !== key) return;
      const box = getAccurateRackBoundingBox(g);
      if (frustum.intersectsBox(box)) {
        const mat4 = new THREE.Matrix4().compose(
          g.position.clone(),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.rotation.y, 0)),
          new THREE.Vector3(1, 1, 1)
        );
        pool.setMatrixAt(visibleCount++, mat4);
      }
    });
    pool.count = visibleCount;
    pool.instanceMatrix.needsUpdate = true;
  }

  for (const key in palletPools) {
    const pool = palletPools[key];
    let visibleCount = 0;
    rackGroups.forEach(g => {
      if (g.userData.poolKey !== key) return;
      const box = getAccurateRackBoundingBox(g);
      if (frustum.intersectsBox(box)) {
        const mat4 = new THREE.Matrix4().compose(
          g.position.clone(),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.rotation.y, 0)),
          new THREE.Vector3(1, 1, 1)
        );
        pool.setMatrixAt(visibleCount++, mat4);
      }
    });
    pool.count = visibleCount;
    pool.instanceMatrix.needsUpdate = true;
  }
  // =======================

  orbitControls.update();
  renderer.render(scene, camera);

  // [PERF] 매 10프레임마다 갱신
  if (!window.__perfTick) window.__perfTick = 0;
  if ((window.__perfTick++ % 10) === 0) updatePerfOverlay();
})();
