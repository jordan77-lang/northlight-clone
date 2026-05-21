        import * as THREE from 'three';
        import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
        import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';
        import { GLTFExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';
        import { RoomEnvironment } from 'https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js';

        // Scene setup
        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0xb0c4de, 150, 600);  // Atmospheric fog for depth
/*
        // Sky sphere — MeshBasicMaterial so it's unaffected by lighting
        const skyGeo = new THREE.SphereGeometry(650, 32, 16);
        const skyMat = new THREE.MeshBasicMaterial({ color: 0xb0c4de, side: THREE.BackSide });
        const skySphere = new THREE.Mesh(skyGeo, skyMat);
        scene.add(skySphere);
*/
        // Camera
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 700); // near 0.5 = better Z precision; far 700 = fog ends at 600
        camera.position.set(0, 5.2, 30);

        // Audio listener — must be on camera for positional audio to work
        const audioListener = new THREE.AudioListener();
        camera.add(audioListener);
        
 
        
        // Helper vector for camera direction
        const cameraDirection = new THREE.Vector3();
        const _videoTmpVec   = new THREE.Vector3(); // scratch vec for video distance checks

        // Door positions and wall colliders for game mode
        let doorPositions = {};
        let wallColliders = []; // Array of bounding boxes for collision detection

        // =====================================================
        // WALKABLE BOUNDARY DEBUG VISUALS
        // =====================================================
        const walkDebugGroup = new THREE.Group();
        walkDebugGroup.visible = false;
        scene.add(walkDebugGroup);

        // Flat roof group — populated later, shown only in game mode
        let roofGroup = null;



        function buildWalkDebug() {
            walkDebugGroup.clear();

            const playerRadius = 1.5;

            // Wall colliders — red boxes expanded by player radius
            const redMat = new THREE.LineBasicMaterial({ color: 0xff2222 });
            for (const wall of wallColliders) {
                const w = (wall.max.x - wall.min.x) + playerRadius * 2;
                const h = wall.max.y - wall.min.y;
                const d = (wall.max.z - wall.min.z) + playerRadius * 2;
                const cx = (wall.min.x + wall.max.x) / 2;
                const cy = (wall.min.y + wall.max.y) / 2;
                const cz = (wall.min.z + wall.max.z) / 2;
                const srcGeo = new THREE.BoxGeometry(w, h, d);
                const edges = new THREE.EdgesGeometry(srcGeo);
                srcGeo.dispose();
                const box = new THREE.LineSegments(edges, redMat.clone());
                box.position.set(cx, cy, cz);
                walkDebugGroup.add(box);
            }
        }

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // Softer, more realistic shadow edges
        renderer.toneMapping = THREE.ACESFilmicToneMapping;  // Cinematic look
        renderer.toneMappingExposure = 1.0;  // Adjust exposure for mood
        renderer.outputColorSpace = THREE.SRGBColorSpace;  // Proper color accuracy
        renderer.dithering = true;  // Eliminate banding in fog/sky gradients — zero cost
        renderer.localClippingEnabled = true;  // Enable local clipping for Y-axis cropping

        // Room environment — free IBL that grounds PBR materials (runs once at load, zero runtime cost)
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        pmremGenerator.dispose();
        renderer.xr.enabled = true;
        document.body.appendChild(renderer.domElement);

        // VR button — only shown when in game mode
        const vrButtonInner = VRButton.createButton(renderer);
        const vrButton = document.createElement('div');
        vrButton.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999;display:none;';
        vrButton.appendChild(vrButtonInner);
        document.body.appendChild(vrButton);

        // Keep camera rig at correct eye height in VR
        renderer.xr.addEventListener('sessionstart', () => {
            needsRender = true;
        });
        renderer.xr.addEventListener('sessionend', () => {
            needsRender = true;
        });

        // =====================================================
        // NAVIGATION MODE SETUP
        // =====================================================
        
        // Detect if device is mobile/touch
        const isMobileDevice = () => {
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
        };
        
        const isMobile = isMobileDevice();
        let currentMode = 'explore';
        let needsRender = true;
        let isLocked = false;
        let itemLightBulbs = []; // Track all light bulbs for visibility toggling
        let positionalAudios = []; // Track positional audio sources for game/explore muting

        // Video optimisation — shared state across all video planes
        // Each entry: { video, texture, plane, baseDistance }
        const videoObjects = [];
        // Distance (world units) beyond which a video is paused to save decode cost
        const VIDEO_PAUSE_DISTANCE = 120;
        
        // UI Setup
        const gameModeBtn = document.getElementById('gameModeBtn');
        const exploreModeBtn = document.getElementById('exploreModeBtn');
        const controlsInfo = document.getElementById('controlsInfo');
        
        if (isMobile) {
            gameModeBtn.disabled = true;
        }
        
        let pointerLockReady = false;

        function setMode(mode) {
            currentMode = mode;
            needsRender = true;
            
            // Toggle light bulb visibility based on mode
            itemLightBulbs.forEach(bulb => {
                bulb.visible = (mode === 'game');
            });

            // Toggle positional audio: audible in game mode, silent in explore mode
            positionalAudios.forEach(pa => {
                pa.setVolume(mode === 'game' ? (pa._baseVolume ?? 1) : 0);
            });
            
            if (mode === 'game') {
                pointerLockReady = false; // require one extra click inside the canvas
                gameModeBtn.classList.add('active');
                exploreModeBtn.classList.remove('active');
                controlsInfo.innerHTML = `
                    <p><strong>Game Mode Controls:</strong></p>
                    <p>WASD / Arrow Keys - Move</p>
                    <p>Mouse - Look around</p>
                    <p style="color: red; background:white; padding:2px 5px;text-transform: uppercase;">Click anywhere to enable navigation</p>
                    <p>(press ESC to release mouse lock)</p>
                `;
                
                isLocked = false;
                camera.position.set(-4, 5.2, 20);
                yaw = 0; // Face inward (toward the gallery)
                pitch = 0;
                const spawnEuler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
                camera.quaternion.setFromEuler(spawnEuler);
                buildWalkDebug();
                walkDebugGroup.visible = debugMode;
                if (roofGroup) roofGroup.visible = true;
                vrButton.style.display = '';
                needsRender = true;
            } else {
                gameModeBtn.classList.remove('active');
                exploreModeBtn.classList.add('active');
                
                controlsInfo.innerHTML = `
                    <p><strong>Explore Mode Controls:</strong></p>
                    <p>Left Drag  :  Orbit</p>
                    <p>Right / Middle Drag  :  Pan</p>
                    <p>Shift + Drag  :  Pan</p>
                    <p>Scroll  :  Zoom</p>
                    <p> Touch: </p>
                    <p>&nbsp; 1-finger  :  Orbit <br>&nbsp; 2-finger  :  Pan + Zoom</p>
                `;
                walkDebugGroup.visible = false;
                if (roofGroup) roofGroup.visible = false;
                vrButton.style.display = 'none';
                needsRender = true;
            }
        }
        
        gameModeBtn.addEventListener('click', () => setMode('game'));
        exploreModeBtn.addEventListener('click', () => setMode('explore'));
        
        // Initialize to explore mode
        setMode('explore');
        
        // Debug mode checkbox
        const debugCheckbox = document.getElementById('debugModeCheckbox');
        debugCheckbox.addEventListener('change', (event) => {
            debugMode = event.target.checked;
            walkDebugGroup.visible = debugMode && currentMode === 'game';
            if (modelScene) {
                updateDebugLabels(modelScene);
                needsRender = true;
            }
        });
        
        // Explore mode camera state
        let exploreCameraDistance = 70;
        let exploreCameraPan = new THREE.Vector2(0, 0);
        let exploreCameraPanY = 0;
        let exploreRotation = new THREE.Vector2(0.5, 0.5);
        let lastExploreMousePos = new THREE.Vector2(0, 0);

        // Load the Northlight 3D model
        const gltfLoader = new GLTFLoader();
        const textureLoader = new THREE.TextureLoader();
        
        // =====================================================
        // MODEL MANAGEMENT
        // =====================================================
        
        // Consolidated model storage
        const models = {
            window: null,
            frontDoor: null,
            table: null,
            sofa: null,
            table2: null,
            sofa2: null,
            mSeat: null,
            backdoor: null,
            b1Seat: null,
            b2Seat: null,
            book1: null,
            book2: null,
            northlight: null
        };
        
        let modelScene = null;

        // Placement dispatch: sub-models call this when loaded so they're placed
        // immediately if the main model is already in the scene, or queued until it is.
        const _placementQueue = {};
        function registerPlacement(key, fn) {
            if (modelScene) { fn(); needsRender = true; }
            else _placementQueue[key] = fn;
        }
        function flushPlacements() {
            for (const key of Object.keys(_placementQueue)) {
                _placementQueue[key]();
                delete _placementQueue[key];
            }
            needsRender = true;
        }
        
        // Factory function for loading models with standard callbacks
        function loadModel(key, path, config = {}) {
            const {
                scale = 10,
                position = [0, 0, 0],
                rotation = [0, 0, 0],
                materialFn = null,
                onLoad = null
            } = config;
            
            gltfLoader.load(path, (gltf) => {
                const model = gltf.scene;
                models[key] = model;
                
                // Always set scale, position, and rotation
                model.scale.set(scale, scale, scale);
                model.position.set(...position);
                model.rotation.set(rotation[0], rotation[1], rotation[2]);
                
                if (materialFn) materialFn(model);
                
                console.log(`${key} model loaded - position:`, position, 'scale:', scale, 'rotation:', rotation);
                if (onLoad) registerPlacement(key, onLoad);
            }, undefined, (error) => {
                console.error(`Error loading ${key} model:`, error);
            });
        }
        
        // Model loading configuration
        const modelConfigs = {
            window: {
                path: './building/window.glb',
                scale: 12,
                rotation: [0, Math.PI, 0],
                position: [0, 0, -10],
                materialFn: (model) => {
                    model.traverse((child) => {
                        if (child.isMesh) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(mat => {
                                if (mat) {
                                    mat.envMapIntensity = 1.0;
                                    mat.metalness = 0.8;
                                    mat.roughness = 0.2;
                                    mat.color.set(0xffffff);
                                }
                            });
                        }
                    });
                },
                onLoad: () => replaceWindowsWithModel(modelScene)
            },
            frontDoor: {
                path: './building/frontdoor.glb',
                scale: 10,
                position: [0, -1, 10],
                onLoad: () => replaceDoorWithModel(modelScene)
            },
            table: {
                path: './building/table.glb',
                scale: 12
            },
            sofa: {
                path: './building/sofa.glb',
                scale: 10
            },
            table2: {
                path: './building/table2.glb',
                scale: 10
            },
            sofa2: {
                path: './building/sofa2.glb',
                scale: 10
            },
            mSeat: {
                path: './building/mSeat.glb',
                scale: 10
            },
            backdoor: {
                path: './building/backdoor.glb',
                scale: 7,
                position: [0, -1, 10],
                onLoad: () => addBackdoorToScene()
            },
            b1Seat: {
                path: './building/b1Seat.glb',
                scale: 7
            },
            b2Seat: {
                path: './building/b2Seat.glb',
                scale: 10
            },
            book1: {
                path: './building/book1.glb'
            },
            book2: {
                path: './building/book2.glb'
            }
        };

        // Keys that are part of the building and always loaded regardless of meta.json
        const buildingModelKeys = new Set(['window', 'frontDoor', 'backdoor']);

        // Load only building-essential models at startup
        for (const [key, config] of Object.entries(modelConfigs)) {
            if (!buildingModelKeys.has(key)) continue;
            loadModel(key, config.path, {
                scale: config.scale || 10,
                position: config.position || [0, 0, 0],
                rotation: config.rotation || [0, 0, 0],
                materialFn: config.materialFn,
                onLoad: config.onLoad
            });
        }

        // Accumulates placement callbacks for furniture models that are still loading.
        // Multiple entries for the same key (e.g. two mSeat instances) are all kept.
        const _pendingFurniturePlacements = {};
        let _furnitureInstanceCounter = 0;

        // Called from loadShow() for each entry in meta.furniture.
        // item must have: model (key) — use "custom" + src for show-relative GLBs.
        // item.collider: true (default) = add collision, false = skip.
        function loadFurnitureModel(item, showTitle) {
            const isCustom = item.model === 'custom';
            const key = isCustom ? ('__custom__' + item.src) : item.model;
            const DEG2RAD = Math.PI / 180;

            // Resolve path: "custom" uses show-relative src, otherwise look up modelConfigs
            let glbPath;
            let modelConfig = null;
            if (isCustom) {
                if (!item.src) { console.warn('Custom furniture item missing src:', item); return; }
                glbPath = 'shows/' + showTitle + '/' + item.src;
            } else {
                modelConfig = modelConfigs[item.model];
                if (!modelConfig) { console.warn('Unknown furniture model:', item.model); return; }
                glbPath = modelConfig.path;
            }

            const placeInstance = () => {
                const clone = models[key].clone();
                if (item.position) clone.position.set(item.position.x ?? 0, item.position.y ?? 0, item.position.z ?? 0);
                if (item.rotation) clone.rotation.set(
                    (item.rotation.x ?? 0) * DEG2RAD,
                    (item.rotation.y ?? 0) * DEG2RAD,
                    (item.rotation.z ?? 0) * DEG2RAD
                );
                if (item.scale != null) {
                    if (typeof item.scale === 'number') clone.scale.setScalar(item.scale);
                    else clone.scale.set(item.scale.x ?? 1, item.scale.y ?? 1, item.scale.z ?? 1);
                }
                applyGLBMaterials(clone, false);
                scene.add(clone);
                if (item.collider !== false) addObjectCollider(clone);
                if (key === 'table' && item.food === true) addTableFoodToScene(clone);
                needsRender = true;
                console.log('Placed furniture instance:', key);
            };

            if (models[key]) {
                // Model already in memory — place immediately (or queue until main scene is ready)
                registerPlacement('furniture_' + key + '_' + (++_furnitureInstanceCounter), placeInstance);
            } else {
                // First request for this model: start loading and accumulate all instances
                if (!_pendingFurniturePlacements[key]) {
                    _pendingFurniturePlacements[key] = [];
                    const cfg = modelConfig || {};
                    loadModel(key, glbPath, {
                        scale: cfg.scale || 1,
                        position: cfg.position || [0, 0, 0],
                        rotation: cfg.rotation || [0, 0, 0],
                        materialFn: cfg.materialFn,
                        onLoad: () => {
                            const fns = _pendingFurniturePlacements[key] || [];
                            delete _pendingFurniturePlacements[key];
                            fns.forEach(fn => fn());
                        }
                    });
                }
                _pendingFurniturePlacements[key].push(placeInstance);
            }
        }

        // =====================================================
        // NORTHLIGHT MODEL PROCESSING
        // =====================================================
        
        function setupModelTransform(model) {
            model.scale.set(10, 10, 10);
            model.position.set(0, 14, 0);
        }
        
        function createAndApplyClippingPlane(model) {
            model.updateWorldMatrix(true, false);
            const modelBbox = new THREE.Box3().setFromObject(model);
            const modelHeight = modelBbox.max.y - modelBbox.min.y;
            const cropHeight = modelBbox.min.y + modelHeight * 0.7;
            
            modelClippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cropHeight);
            
            // Apply to all known materials
            [wallpaperMaterial, brickMaterial, whiteMaterial, greenMaterial, yellowMaterial].forEach(mat => {
                mat.clippingPlanes = [modelClippingPlane];
            });
        }
        
        function processModelMeshes(model) {
            model.traverse((child) => {
                if (!child.isMesh) return;
                
                // Apply clipping to all materials
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => {
                    if (mat) mat.clippingPlanes = [modelClippingPlane];
                });
                
                // Extract spatial data
                const bbox = new THREE.Box3().setFromObject(child);
                const center = bbox.getCenter(new THREE.Vector3());
                const size = bbox.getSize(new THREE.Vector3());
                const name = child.name.toLowerCase();
                
                // Store door positions
                if (name.includes('door')) {
                    doorPositions[child.name] = center.clone();
                    console.log('Found door:', child.name, 'at position:', center);
                }
                
                // Detect wall colliders
                if (size.y > 5 && (size.x > 1 || size.z > 1)) {
                    wallColliders.push(bbox.clone());
                    console.log('Added wall collider:', child.name, 'Size:', size);
                }
                
                child.castShadow = true;
                child.receiveShadow = true;
            });
        }
        
        function finalizeModelLoading(model) {
            colorizeModel(model);
            scene.add(model);
            flushPlacements();
            updateDebugLabels(model);
            needsRender = true;
        }
        
        gltfLoader.load('./building/Northlight.glb', (gltf) => {
            const model = gltf.scene;
            modelScene = model;
            
            setupModelTransform(model);
            createAndApplyClippingPlane(model);
            processModelMeshes(model);
            finalizeModelLoading(model);
        }, undefined, (error) => {
            console.error('Error loading Northlight model:', error);
        });

        // Exterior ground
        const concreteFloorTexture = textureLoader.load('./building/concrete.jpg');
        concreteFloorTexture.wrapS = THREE.RepeatWrapping;
        concreteFloorTexture.wrapT = THREE.RepeatWrapping;
        concreteFloorTexture.repeat.set(1, 2);
        concreteFloorTexture.magFilter = THREE.LinearFilter;
        concreteFloorTexture.minFilter = THREE.LinearMipmapLinearFilter;
        concreteFloorTexture.colorSpace = THREE.SRGBColorSpace;
        concreteFloorTexture.anisotropy = 16;

        const groundGeometry = new THREE.PlaneGeometry(84.8, 186);
        const groundMaterial = new THREE.MeshStandardMaterial({
            map: concreteFloorTexture,
            color: 0xcccccc,  // Brighter for better lighting
            roughness: 0.7,  // Slightly less rough for realism
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(-1, -1.8, -49.4);
        ground.castShadow = true;  // Ground casts shadows on itself
        ground.receiveShadow = true;  // Ground receives shadows from other objects
        scene.add(ground);

        // Add sky blue box — fog:false + same color as skyMat so tone-mapping output matches
        const boxGeometry = new THREE.BoxGeometry(32.5, 2, 11);
        const boxMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.FrontSide });
        const box = new THREE.Mesh(boxGeometry, boxMat);
        box.position.set(-27.5, -2, 38.5);
        scene.add(box);

        // =====================================================
        // FLAT ROOF — wooden beams, visible only in game mode
        // =====================================================

        (function buildFlatRoof() {



            const woodTex = textureLoader.load('./building/wood.png');
            woodTex.wrapS = THREE.RepeatWrapping;
            woodTex.wrapT = THREE.RepeatWrapping;
            woodTex.repeat.set(2, 1);
            woodTex.magFilter = THREE.LinearFilter;
            woodTex.minFilter = THREE.LinearMipmapLinearFilter;
            woodTex.colorSpace = THREE.SRGBColorSpace;
            woodTex.anisotropy = 8;

            // MeshBasicMaterial to stay lit regardless of ambient (consistent with rest of scene)
            const beamMat = new THREE.MeshBasicMaterial({ map: woodTex, color: 0xf0f0f0 });
            // Cross-brace metal — near-black painted steel like photo
            const braceMat = new THREE.MeshStandardMaterial({ color: 0xa0a0a0 });
            // Dark void above the beams
            const darkMat = new THREE.MeshBasicMaterial({ color: 0x151210, side: THREE.BackSide });
            // Can-light housing — matte white disc
            const canMat  = new THREE.MeshBasicMaterial({ color: 0xe8e8e0 });
            // Can-light emissive lens — bright white circle
            const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

            roofGroup = new THREE.Group();
            roofGroup.name = 'flatRoof';
            roofGroup.visible = false;

            const X1 = -45, X2 = 42;
            const Z1 = -142, Z2 = 44;
            const W  = X2 - X1;   // 84
            const D  = Z2 - Z1;   // 186
            const CX = (X1+X2)*0.5;
            const CZ = (Z1+Z2)*0.5;

            const CEIL_Y = 28;       // top-of-structure / deck height

            // ── Primary joists: run along Z (gallery depth), spaced along X ──
            const JOIST_SPACING = 7;  // gap between joists
            const JW = 0.55;          // joist face-width
            const JH = 2.0;           // joist depth (hangs down)
            const JY = CEIL_Y - JH * 0.5;

            function addBox(x, y, z, w, h, d, mat) {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
                m.position.set(x, y, z);
                roofGroup.add(m);
            }

            // Joists spanning full gallery WIDTH (X axis), spaced along Z
            const joistXs = [];  // reused by brace loop — stores Z positions of joists
            for (let z = Z1; z <= Z2 + 0.01; z += JOIST_SPACING) {
                joistXs.push(z);
                addBox(CX, JY, z, W, JH, JW, beamMat);
            }

            // ── Cross-blocking / purlins: run along Z, spaced along X ──
            const CROSS_SPACING = 9;
            const CW = 0.4;   // cross-piece width
            const CH = 1.4;   // cross-piece depth (shallower than joists)
            const CY = CEIL_Y - CH * 0.5 - 0.05; // hang from same top face

            const crossZs = [];  // stores X positions of cross-pieces
            for (let x = X1; x <= X2 + 0.01; x += CROSS_SPACING) {
                crossZs.push(x);
                addBox(x, CY, CZ, CW, CH, D, beamMat);
            }

            // ── Ledger beams on short end walls (front & back) ──
            addBox(CX, JY, Z1 + JW*0.5, W, JH, JW, beamMat);
            addBox(CX, JY, Z2 - JW*0.5, W, JH, JW, beamMat);

            // ── X-diagonal bracing between adjacent joist bays ──
            const BT = 0.18;
            const BW = 0.12;

            for (let zi = 0; zi < joistXs.length - 1; zi++) {
                for (let xi = 0; xi < crossZs.length - 1; xi++) {
                    const bz = (joistXs[zi] + joistXs[zi+1]) * 0.5;
                    const bx = (crossZs[xi] + crossZs[xi+1]) * 0.5;
                    const spanZ = joistXs[zi+1] - joistXs[zi];
                    const spanX = crossZs[xi+1] - crossZs[xi];
                    const len   = Math.sqrt(spanX*spanX + spanZ*spanZ);
                    const angleY = Math.atan2(spanX, spanZ);

                    // Diagonal 1  (\)
                    const d1 = new THREE.Mesh(new THREE.BoxGeometry(BW, BT, len), braceMat);
                    d1.position.set(bx, CEIL_Y - JH + BT*0.5, bz);
                    d1.rotation.y = angleY;
                    roofGroup.add(d1);

                    // Diagonal 2  (/)
                    const d2 = new THREE.Mesh(new THREE.BoxGeometry(BW, BT, len), braceMat);
                    d2.position.set(bx, CEIL_Y - JH + BT*0.5, bz);
                    d2.rotation.y = -angleY;
                    roofGroup.add(d2);
                }
            }

            // ── Dark deck above ──
            const deck = new THREE.Mesh(new THREE.PlaneGeometry(W, D), darkMat);
            deck.rotation.x = Math.PI * 0.5;
            deck.position.set(CX, CEIL_Y + 0.05, CZ);
            roofGroup.add(deck);

            // ── Translucent black top plane (covers roof exterior) ──
            const topMatTexture = textureLoader.load('./building/roof.png');
            topMatTexture.wrapS = THREE.RepeatWrapping;
            topMatTexture.wrapT = THREE.RepeatWrapping;
            topMatTexture.repeat.set(4, 4);
            topMatTexture.magFilter = THREE.LinearFilter;
            topMatTexture.minFilter = THREE.LinearMipmapLinearFilter;
            topMatTexture.colorSpace = THREE.SRGBColorSpace;
            topMatTexture.anisotropy = 8;
            
            const topMat = new THREE.MeshStandardMaterial({ color: 0x000000, side: THREE.DoubleSide, transparent: true, opacity: 0.95, map: topMatTexture });
            const topPlane = new THREE.Mesh(new THREE.PlaneGeometry(W+10, D+10), topMat);
            topPlane.rotation.x = Math.PI * 0.5;
            topPlane.position.set(CX, CEIL_Y + 0.2, CZ);
            roofGroup.add(topPlane);

            // ── Can lights — hanging at regular grid between joists ──
            const CAN_R    = 0.45;   // housing radius
            const CAN_H    = 0.35;   // housing depth
            const LENS_R   = 0.30;   // lens radius
            const CAN_Y    = CEIL_Y - JH + CAN_H*0.5 + 0.02;  // bottom of cross-pieces
            const canGeom  = new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 12);
            const lensGeom = new THREE.CircleGeometry(LENS_R, 12);

            // joistXs = Z positions of width-spanning joists
            // crossZs  = X positions of depth-spanning cross-pieces
            for (let zi = 0; zi < joistXs.length - 1; zi++) {
                const lz = (joistXs[zi] + joistXs[zi+1]) * 0.5;
                for (let xi = 0; xi < crossZs.length - 1; xi++) {
                    if ((zi + xi) % 2 !== 0) continue;
                    const lx = (crossZs[xi] + crossZs[xi+1]) * 0.5;
                    const housing = new THREE.Mesh(canGeom, canMat);
                    housing.position.set(lx, CAN_Y, lz);
                    roofGroup.add(housing);
                    const lens = new THREE.Mesh(lensGeom, lensMat);
                    lens.rotation.x = Math.PI * 0.5;
                    lens.position.set(lx, CAN_Y - CAN_H*0.5 - 0.01, lz);
                    roofGroup.add(lens);
                }
            }

            scene.add(roofGroup);
        })();

        // Call downloadRoofGLB() in the browser console to export the roof as a .glb file
        function downloadRoofGLB() {
            const exporter = new GLTFExporter();
            const wasVisible = roofGroup.visible;
            roofGroup.visible = true; // GLTFExporter skips invisible objects
            roofGroup.traverse(c => { c._wasVisible = c.visible; c.visible = true; });
            exporter.parse(roofGroup, (glb) => {
                roofGroup.visible = wasVisible;
                roofGroup.traverse(c => { c.visible = c._wasVisible; });
                const blob = new Blob([glb], { type: 'application/octet-stream' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'roof.glb';
                a.click();
                URL.revokeObjectURL(a.href);
            }, (err) => {
                roofGroup.visible = wasVisible;
                roofGroup.traverse(c => { c.visible = c._wasVisible; });
                console.error('GLTFExporter error:', err);
            }, { binary: true });
        }
        //setTimeout(() => { downloadRoofGLB(); }, 3000);

        // =====================================================
        // LIGHTING CONFIGURATION & SETUP
        // =====================================================
        
        let ambientLight, hemiLight, directionalLight, fillLight, frontFillLight, backFillLight;
        
        const lightingConfig = {
            ambient: { color: 0xffffff, intensity: 0.5 },  // Reduced from 1.2
            hemisphere: { sky: 0xfff8f0, ground: 0x404040, intensity: 1 },  // Increased from 1.0
            directional: {
                color: 0xfff8f0,
                intensity: 1,  // Reduced from 1.8 for subtlety
                position: [50, 80, 50],
                shadow: { mapSize: 1024, left: -100, right: 100, top: 100, bottom: -100 }  // Reduced from 2048 for performance
            },
            fill: { color: 0xf0f4ff, intensity: 1.3, position: [-50, 40, -50] },  // Increased from 1.2
            frontFill: { color: 0xffffff, intensity: 1.1, position: [0, 30, 100] },  // Increased from 1.0
            backFill: { color: 0xfff0e8, intensity: 1.0, position: [0, 20, -150] }  // Increased from 0.8
        };
        
        function setupLighting() {
            // Ambient light
            ambientLight = new THREE.AmbientLight(lightingConfig.ambient.color, lightingConfig.ambient.intensity);
            scene.add(ambientLight);
            
            // Hemisphere light (sky/ground)
            const hc = lightingConfig.hemisphere;
            hemiLight = new THREE.HemisphereLight(hc.sky, hc.ground, hc.intensity);
            scene.add(hemiLight);
            
            // Key directional light
            const dc = lightingConfig.directional;
            directionalLight = new THREE.DirectionalLight(dc.color, dc.intensity);
            directionalLight.position.set(...dc.position);
            directionalLight.castShadow = true;
            directionalLight.shadow.mapSize.set(dc.shadow.mapSize, dc.shadow.mapSize);
            directionalLight.shadow.camera.left = dc.shadow.left;
            directionalLight.shadow.camera.right = dc.shadow.right;
            directionalLight.shadow.camera.top = dc.shadow.top;
            directionalLight.shadow.camera.bottom = dc.shadow.bottom;
            directionalLight.shadow.camera.near = 1;
            directionalLight.shadow.camera.far = 300;  // Tighter far plane = better shadow depth precision
            directionalLight.shadow.bias = -0.0005;  // Eliminate shadow acne
            directionalLight.shadow.normalBias = 0.02;  // Prevent streaking on curved surfaces
            directionalLight.shadow.radius = 4;  // Softer penumbra edge — free with PCFSoftShadowMap
            scene.add(directionalLight);
            
            // Fill lights
            fillLight = new THREE.DirectionalLight(lightingConfig.fill.color, lightingConfig.fill.intensity);
            fillLight.position.set(...lightingConfig.fill.position);
            scene.add(fillLight);
            
            frontFillLight = new THREE.DirectionalLight(lightingConfig.frontFill.color, lightingConfig.frontFill.intensity);
            frontFillLight.position.set(...lightingConfig.frontFill.position);
            scene.add(frontFillLight);
            
            backFillLight = new THREE.DirectionalLight(lightingConfig.backFill.color, lightingConfig.backFill.intensity);
            backFillLight.position.set(...lightingConfig.backFill.position);
            scene.add(backFillLight);
        }
        
        setupLighting();
        
        // =====================================================
        // MODEL CLIPPING
        // =====================================================
        
        let modelClippingPlane = null;



        // wallpaperMaterial created without map; texture generated after first paint
        const wallpaperMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,  // Reduced for smoother walls (from 0.0)
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        
        const wallTexture = textureLoader.load('./building/wall.png');
        wallTexture.wrapS = THREE.RepeatWrapping;
        wallTexture.wrapT = THREE.RepeatWrapping;
        wallTexture.repeat.set(9, 4);
        wallTexture.magFilter = THREE.LinearFilter;
        wallTexture.minFilter = THREE.LinearMipmapLinearFilter;
        wallTexture.colorSpace = THREE.SRGBColorSpace;  // Proper color space
        wallTexture.anisotropy = 16;  // Better detail at angles
        wallpaperMaterial.map = wallTexture;
        wallpaperMaterial.needsUpdate = true;

        const brickTexture = textureLoader.load('./building/brick.jpg');
        brickTexture.wrapS = THREE.RepeatWrapping;
        brickTexture.wrapT = THREE.RepeatWrapping;
        brickTexture.repeat.set(2, 3);
        brickTexture.magFilter = THREE.LinearFilter;
        brickTexture.minFilter = THREE.LinearMipmapLinearFilter;
        brickTexture.colorSpace = THREE.SRGBColorSpace;
        brickTexture.anisotropy = 16;

        const brickMaterial = new THREE.MeshStandardMaterial({
            map: brickTexture,
            roughness: 0.9,
            metalness: 0.0,
            vertexColors: false
        });
        
        const whiteMaterial = new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.8,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        
        const skyBlueMaterial = new THREE.MeshBasicMaterial({
            color: 0xb0c4de,
            side: THREE.DoubleSide
        });
        
        const greenMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ff00,
            roughness: 0.5,
            metalness: 0.1,
            emissive: 0x003300
        });
        
        const yellowMaterial = new THREE.MeshStandardMaterial({
            color: 0xffff00,
            roughness: 0.6,
            metalness: 0.1,
            emissive: 0x333300
        });
        
        const wall1Material = new THREE.MeshStandardMaterial({
            map: brickTexture,
            color: 0xffffff,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        wall1Material.needsUpdate = true;
        
        const pedestalTexture = textureLoader.load('./building/pedestal.png');
        pedestalTexture.wrapS = THREE.RepeatWrapping;
        pedestalTexture.wrapT = THREE.RepeatWrapping;
        pedestalTexture.repeat.set(4, 9);
        pedestalTexture.magFilter = THREE.LinearFilter;
        pedestalTexture.minFilter = THREE.LinearMipmapLinearFilter;
        pedestalTexture.colorSpace = THREE.SRGBColorSpace;
        pedestalTexture.anisotropy = 16;
        
        // Create procedural stars texture
        function createStarsTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            
            // Dark background (00001d)
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Star color (ffe8de - warm white/beige)
            const starColor = '#dedede';
            
            // Settings
            const scale = 2;
            const density = .1;
            const variation = 0;
            
            // Generate stars
            const numStars = Math.floor(canvas.width * canvas.height * density / 100);
            for (let i = 0; i < numStars; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                const radius = Math.random() * scale * 0.5 + 0.5;
                const opacity = 0.3 + Math.random() * (1 - variation * 0.3);
                
                ctx.fillStyle = starColor;
                ctx.globalAlpha = opacity;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            
            // Add some glow to stars
            for (let i = 0; i < numStars * 0.3; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                const radius = Math.random() * scale * 1.5 + 1;
                
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
                gradient.addColorStop(1, 'rgba(0, 0, 29, 0)');
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            return texture;
        }
        
        const tableMaterial = new THREE.MeshBasicMaterial({
            color: 0x111111, // placeholder until stars texture is ready
            side: THREE.DoubleSide
        });
        setTimeout(() => {
            tableMaterial.map = createStarsTexture();
            tableMaterial.color.set(0xffffff);
            tableMaterial.needsUpdate = true;
            needsRender = true;
        }, 0);
        
        // Create procedural roman paving texture
        function createRomanPavingTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            
            // Mortar color (light grey)
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Stone colors palette
            const stoneColors = ['#9b8b77', '#a89784', '#8b7b6b', '#b5a595', '#a08070'];
            
            // Settings
            const scale = 2;
            const depth = 0.5;
            
            // Draw roman paving stones - rectangular pattern
            const stoneWidth = 80 / scale;
            const stoneHeight = 50 / scale;
            const mortarWidth = 2;
            
            for (let y = 0; y < canvas.height; y += stoneHeight + mortarWidth) {
                // Offset every other row for brick-like pattern
                const offset = ((y / (stoneHeight + mortarWidth)) % 2) * (stoneWidth / 2);
                for (let x = -offset; x < canvas.width; x += stoneWidth + mortarWidth) {
                    // Random stone color
                    const color = stoneColors[Math.floor(Math.random() * stoneColors.length)];
                    ctx.fillStyle = color;
                    ctx.fillRect(x, y, stoneWidth, stoneHeight);
                    
                    // Add shadow/depth on top and left
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
                    ctx.fillRect(x, y, stoneWidth, 2);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
                    ctx.fillRect(x, y, 2, stoneHeight);
                    
                    // Add highlight on bottom and right
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.fillRect(x, y + stoneHeight - 2, stoneWidth, 2);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                    ctx.fillRect(x + stoneWidth - 2, y, 2, stoneHeight);
                    
                    // Add subtle variation/texture within stone
                    for (let i = 0; i < 3; i++) {
                        const spotX = x + Math.random() * stoneWidth;
                        const spotY = y + Math.random() * stoneHeight;
                        ctx.fillStyle = `rgba(0, 0, 0, ${0.05 * Math.random()})`;
                        ctx.fillRect(spotX, spotY, 3, 3);
                    }
                }
            }
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            return texture;
        }
        
        const romanPavingTexture = createRomanPavingTexture();
        const table2Material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: romanPavingTexture,
            side: THREE.DoubleSide
        });
        
        // Create procedural satin texture
        function createSatinTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            
            // Dark background (000014)
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Main satin color (2937ff - deep blue)
            const satinColor = '#000000';
            
            // Settings
            const scale = 200;
            
            // Create satin sheen effect with diagonal lines and gradients
            for (let y = 0; y < canvas.height; y += 3 * scale) {
                // Alternating light and dark lines for satin sheen
                if ((y / (3 * scale)) % 2 === 0) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                } else {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                }
                ctx.fillRect(0, y, canvas.width, 2 * scale);
            }
            
            // Add fabric texture with small random variations
            for (let i = 0; i < 2000; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                const brightness = Math.random() * 0.3;
                ctx.fillStyle = `rgba(0, 0, 0, ${(0.2 + brightness)})`;
                ctx.fillRect(x, y, Math.random() * 2 + 1, 1);
            }
            
            // Add subtle wave pattern for satin sheen
            for (let x = 0; x < canvas.width; x += 40 * scale) {
                const gradient = ctx.createLinearGradient(x, 0, x + 40 * scale, 0);
                gradient.addColorStop(0, 'rgba(100, 150, 255, 0)');
                gradient.addColorStop(0.5, 'rgba(100, 150, 255, 0.3)');
                gradient.addColorStop(1, 'rgba(100, 150, 255, 0)');
                
                ctx.fillStyle = gradient;
                ctx.fillRect(x, 0, 40 * scale, canvas.height);
            }
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            return texture;
        }
        
        const satinTexture = createSatinTexture();
        const sofaMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: satinTexture,
            side: THREE.DoubleSide
        });

        // Procedural canvas/fabric weave roughness map — used by the 'fabric' frame type
        function createFabricWeaveTexture() {
            const size = 512;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            // Mid-grey base (roughness map)
            ctx.fillStyle = '#999';
            ctx.fillRect(0, 0, size, size);
            const tw = 6, gap = 6; // scaled with canvas (was 3/3 at 256)
            // Warp threads (vertical)
            for (let x = 0; x < size; x += tw + gap) {
                ctx.fillStyle = 'rgba(40,30,20,0.38)';
                ctx.fillRect(x, 0, tw, size);
            }
            // Weft threads (horizontal)
            for (let y = 0; y < size; y += tw + gap) {
                ctx.fillStyle = 'rgba(40,30,20,0.38)';
                ctx.fillRect(0, y, size, tw);
            }
            // Subtle natural noise — density scaled with canvas area
            for (let i = 0; i < 8000; i++) {
                const v = Math.random() > 0.5 ? 255 : 0;
                ctx.fillStyle = `rgba(${v},${v},${v},0.025)`;
                ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.anisotropy = renderer.capabilities.maxAnisotropy;
            return tex;
        }
        const fabricWeaveTexture = createFabricWeaveTexture();

        // Procedural normal map that gives the fabric surface genuine 3D relief
        function createFabricNormalMap() {
            const size = 512;
            const tw = 12; // thread cycle width in pixels — scaled with canvas (was 6 at 256)
            // Build a heightfield: cosine bumps per thread axis, plain weave alternation
            const h = new Float32Array(size * size);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const tx = (x % tw) / tw;
                    const ty = (y % tw) / tw;
                    const warpH = Math.cos(tx * Math.PI * 2) * 0.5 + 0.5;
                    const weftH = Math.cos(ty * Math.PI * 2) * 0.5 + 0.5;
                    const warpOn = (Math.floor(x / tw) + Math.floor(y / tw)) % 2 === 0;
                    h[y * size + x] = warpOn ? warpH * 0.75 + weftH * 0.25
                                              : warpH * 0.25 + weftH * 0.75;
                }
            }
            // Derive RGB normal map via Sobel filter on the heightfield
            const canvas2 = document.createElement('canvas');
            canvas2.width = size; canvas2.height = size;
            const ctx2 = canvas2.getContext('2d');
            const img = ctx2.createImageData(size, size);
            const strength = 6.0; // bump intensity
            const s = size;
            const ht = (x, y) => h[((y + s) % s) * s + ((x + s) % s)];
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const dx = (ht(x+1,y-1) + 2*ht(x+1,y) + ht(x+1,y+1))
                             - (ht(x-1,y-1) + 2*ht(x-1,y) + ht(x-1,y+1));
                    const dy = (ht(x-1,y+1) + 2*ht(x,y+1) + ht(x+1,y+1))
                             - (ht(x-1,y-1) + 2*ht(x,y-1) + ht(x+1,y-1));
                    const nx = -dx * strength;
                    const ny = -dy * strength;
                    const nz = 1.0;
                    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                    const i = (y * size + x) * 4;
                    img.data[i]   = Math.round((nx/len * 0.5 + 0.5) * 255);
                    img.data[i+1] = Math.round((ny/len * 0.5 + 0.5) * 255);
                    img.data[i+2] = Math.round((nz/len * 0.5 + 0.5) * 255);
                    img.data[i+3] = 255;
                }
            }
            ctx2.putImageData(img, 0, 0);
            const tex = new THREE.CanvasTexture(canvas2);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.anisotropy = renderer.capabilities.maxAnisotropy;
            return tex;
        }
        const fabricNormalTexture = createFabricNormalMap();

        const pedestalMaterial = new THREE.MeshStandardMaterial({
            map: pedestalTexture,
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        
        function addWallPlanes(child, mat) {
            child.updateWorldMatrix(true, false);
            child.visible = false;  // Hide the actual wall

            const bbox = new THREE.Box3().setFromObject(child);
            const size = bbox.getSize(new THREE.Vector3());
            const center = bbox.getCenter(new THREE.Vector3());

            const minAxis = size.x < size.z ? 'x' : 'z';
            const planeW = minAxis === 'x' ? size.z : size.x;
            const planeH = size.y;

            // Only create one plane on the positive side
            const side = 1;
            const planeGeom = new THREE.PlaneGeometry(planeW, planeH);
            // Clone material and apply clipping plane if it exists
            const planeMat = mat.clone();
            if (modelClippingPlane) {
                planeMat.clippingPlanes = [...(planeMat.clippingPlanes || []), modelClippingPlane];
            }
            const planeMesh = new THREE.Mesh(planeGeom, planeMat);
            planeMesh.position.copy(center);

            if (minAxis === 'x') {
                planeMesh.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
                planeMesh.position.x += side * (size.x / 2);
            } else {
                planeMesh.rotation.y = side === -1 ? Math.PI : 0;
                planeMesh.position.z += side * (size.z / 2);
            }

            if(child.name=="Wall11"){
                planeMesh.position.x -= 1;
                planeMesh.position.z += .3;
            }
            else if(child.name=="Wall2"){
                planeMesh.position.z += .53;
                planeMesh.position.x -= .05;
                planeMesh.rotation.y += 0.01;
                planeMesh.scale.set(1.02,1,1);
            }
            else if(child.name=="Wall8"){
                planeMesh.position.z -= .2;
            }
            else if(child.name=="Wall9"){
                planeMesh.scale.set(.8,1,1);
            }
            else if(child.name=="Wall10"){
                planeMesh.position.x += .05;
                planeMesh.position.z += .5;
            }
            else if(child.name=="Wall1" || child.name=="Wall6"){
                // Scale texture repeat to maintain consistent brick size
                if(mat.map && mat.map.repeat) {
                    const referenceSize = 30;
                    const scaleX = planeW / referenceSize;
                    const scaleY = planeH / referenceSize;
                    planeMat.map = planeMat.map.clone();
                    planeMat.map.repeat.set(2 * scaleX, 3 * scaleY);
                }
                if(child.name=="Wall1"){
                    planeMesh.position.x -= .4;
                    planeMesh.scale.set(.98,1,1);
                }
            }
            else if(child.name=="Wall0"){
                planeMesh.position.x += .65;
                planeMesh.position.z += .3;
                planeMesh.scale.set(1,1,1);
            }
            else if(child.name=="Wall16"){
                planeMesh.position.x -= .4;
            }
            scene.add(planeMesh);
        }

        function createBrickFacade(width = 10, height = 10, depth = 0.5) {
            // Create a thin box (sheet) with brick on outside and wall texture on inside
            const geometry = new THREE.BoxGeometry(width, height, depth);
            
            // Calculate texture repeat scaling for consistent brick size
            const referenceSize = 30;
            const scaleX = width / referenceSize;
            const scaleY = height / referenceSize;
            
            // Helper function to create brick material with scaled repeats
            const createScaledBrickMaterial = () => {
                const mat = wall1Material.clone();
                if(mat.map) {
                    mat.map = mat.map.clone();
                    mat.map.repeat.set(2 * scaleX, 3 * scaleY);
                }
                return mat;
            };
            
            // Create material array for the 6 faces: right, left, top, bottom, front, back
            const materials = [
                createScaledBrickMaterial(),      // right (+x): brick
                createScaledBrickMaterial(),      // left (-x): brick
                createScaledBrickMaterial(),      // top (+y): brick
                createScaledBrickMaterial(),      // bottom (-y): brick
                createScaledBrickMaterial(),      // front (+z): brick
                wallpaperMaterial.clone()         // back (-z): wallpaper (inside)
            ];
            
            const facade = new THREE.Mesh(geometry, materials);
            return facade;
        }



        function replaceDoorWithModel(model) {
            if (!models.frontDoor) {
                console.warn('Front door model not loaded yet');
                return;
            }


            const clonedDoorAlt = models.frontDoor.clone();
            clonedDoorAlt.position.set(-4, 11, 43.5);
            clonedDoorAlt.scale.set(21, 25, 2);
           
            // Brighten door materials while preserving textures (no clipping)
            clonedDoorAlt.traverse((child) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m, idx) => {
                        if (m) {
                            // Create MeshBasicMaterial preserving the texture map if it exists
                            const basicMat = new THREE.MeshBasicMaterial({
                                map: m.map || null,
                                color: m.color || 0xffffff,
                                side: THREE.DoubleSide
                            });
                            if (Array.isArray(child.material)) {
                                child.material[idx] = basicMat;
                            } else {
                                child.material = basicMat;
                            }
                        }
                    });
                }
            });

            scene.add(clonedDoorAlt);


            // Clone and add the front door model to the scene
            const clonedDoor = models.frontDoor.clone();
            clonedDoor.position.set(-4, 11, 37);
            clonedDoor.scale.set(21, 25, 25);
            clonedDoor.rotation.y = 180 * (Math.PI / 180); // Rotate 180 degrees to face the correct direction
            
            // Brighten door materials while preserving textures (no clipping)
            clonedDoor.traverse((child) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m, idx) => {
                        if (m) {
                            // Create MeshBasicMaterial preserving the texture map if it exists
                            const basicMat = new THREE.MeshBasicMaterial({
                                map: m.map || null,
                                color: m.color || 0xffffff,
                                side: THREE.DoubleSide
                            });
                            if (Array.isArray(child.material)) {
                                child.material[idx] = basicMat;
                            } else {
                                child.material = basicMat;
                            }
                        }
                    });
                }
            });
            
            scene.add(clonedDoor);
            
            console.log('Added front door model to scene');
        }

        // Convert all meshes in a GLB clone to MeshBasicMaterial preserving original map/color
        function applyGLBMaterials(object, flag) {
            object.traverse((child) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    const basics = mats.map(m => new THREE.MeshBasicMaterial({
                        map: m.map || null,
                        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
                        side: THREE.DoubleSide
                    }));
                    child.material = Array.isArray(child.material) ? basics : basics[0];
                    if(flag === false) {
                        return;
                    }
                    child.castShadow = true;  // Enable shadow casting
                    child.receiveShadow = true;  // Enable shadow receiving
                    
                }
            });
        }

        // =====================================================
        // PROCEDURAL FOOD ITEMS FOR TABLE
        // =====================================================

        function addTableFoodToScene(tableObj) {
            tableObj.updateWorldMatrix(true, true);
            const bbox = new THREE.Box3().setFromObject(tableObj);
            const tableTopY = bbox.max.y + 0.05;

            // Centre of the table surface
            const cx = (bbox.min.x + bbox.max.x) / 2;
            const cz = (bbox.min.z + bbox.max.z) / 2;
            // Half extents (with a small inset)
            const hx = (bbox.max.x - bbox.min.x) / 2 - 1.5;
            const hz = (bbox.max.z - bbox.min.z) / 2 - 1.5;

            const foodGroup = new THREE.Group();
            scene.add(foodGroup);

            function mat(color, rough = 0.7, metal = 0.0) {
                return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.FrontSide });
            }

            // Place a lathe bowl centred at (x,z), scaled by s, coloured c
            function makeBowl(x, z, s, color) {
                const geo = new THREE.LatheGeometry([
                    new THREE.Vector2(0,0), new THREE.Vector2(0.9,0.12),
                    new THREE.Vector2(1.2,0.5), new THREE.Vector2(1.1,0.95), new THREE.Vector2(0.7,1.1)
                ], 24);
                const m = new THREE.Mesh(geo, mat(color, 0.45, 0.1));
                m.position.set(x, tableTopY, z);
                m.scale.setScalar(s);
                foodGroup.add(m);
                return m;
            }

            // Natural item positions: (offsetX_fraction, offsetZ_fraction, rotationY)
            // fractions are of half-extents so -1..1 maps to the table edge
            // items placed as if someone laid them out loosely:
            //   big centrepiece items cluster in the middle/back
            //   plates/cups/napkins sit towards the near/side edges
            const items = [
                // label,   fx,     fz,    rotY
                ['fruit',   -0.72,  -0.62,  0.2 ],
                ['bread',    0.05,  -0.78,  0.0 ],
                ['chips',    0.68,  -0.55, -0.15],
                ['veggie',  -0.55,   0.05,  0.3 ],
                ['salsa',    0.38,  -0.12,  0.0 ],
                ['guac',     0.72,   0.22,  0.1 ],
                ['cheese',  -0.08,   0.15,  0.35],
                ['punch',   -0.62,   0.55, -0.2 ],
                ['sandwich', 0.18,   0.55,  0.5 ],
                ['pitcher',  0.62,  -0.78,  0.25],
                ['candy',   -0.80,  -0.18,  0.1 ],
                ['cookies', -0.35,   0.72,  0.0 ],
                ['plates',   0.78,   0.72, -0.1 ],
                ['cups',     0.42,   0.82,  0.0 ],
                ['napkins', -0.22,   0.85,  0.15],
                ['cupcakes', 0.78,  -0.25,  0.0 ],
            ];

            items.forEach(([label, fx, fz, rotY]) => {
                const bx = cx + fx * hx;
                const bz = cz + fz * hz;

                if (label === 'fruit') {
                    makeBowl(bx, bz, 0.72, 0xd4c4a8);
                    const fc = [0xff3333, 0xffaa00, 0xffee22, 0x66cc00, 0xcc44aa, 0xff6622];
                    [[0,0,0],[0.42,0,0.33],[-0.4,0,0.26],[0.2,0.26,-0.36],[-0.23,0.23,-0.28],[0.04,0.35,0.1]].forEach(([ox,oy,oz],i) => {
                        const r = 0.2 + (i%3)*0.035;
                        const f = new THREE.Mesh(new THREE.SphereGeometry(r,10,8), mat(fc[i%fc.length],0.55));
                        f.position.set(bx+ox, tableTopY+0.5+oy, bz+oz);
                        foodGroup.add(f);
                        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.16,5), mat(0x228800,0.8));
                        s.position.set(f.position.x, f.position.y+r+0.06, f.position.z);
                        foodGroup.add(s);
                    });
                }

                else if (label === 'bread') {
                    const geo = new THREE.LatheGeometry([
                        new THREE.Vector2(0,0),new THREE.Vector2(1.0,0.16),
                        new THREE.Vector2(1.35,0.65),new THREE.Vector2(1.22,1.25),new THREE.Vector2(1.28,1.38)
                    ], 32);
                    const basket = new THREE.Mesh(geo, mat(0x8b6914,0.95));
                    basket.position.set(bx, tableTopY, bz);
                    basket.scale.setScalar(0.88);
                    basket.rotation.y = rotY;
                    foodGroup.add(basket);
                    // inner bottom cap
                    const breadCap = new THREE.Mesh(new THREE.CircleGeometry(0.88, 32), mat(0x8b6914,0.95));
                    breadCap.rotation.x = -Math.PI / 2;
                    breadCap.position.set(bx, tableTopY + 0.142, bz);
                    foodGroup.add(breadCap);
                    for (let b = 0; b < 4; b++) {
                        const band = new THREE.Mesh(new THREE.TorusGeometry(1.2-b*0.02,0.038,5,32), mat(0x6b4f0a,0.98));
                        band.rotation.x = Math.PI/2;
                        band.position.set(bx, tableTopY+0.28*b+0.16, bz);
                        band.scale.setScalar(0.88);
                        foodGroup.add(band);
                    }
                    [[0,0],[0.5,0.35],[-0.46,0.3],[0.18,-0.46],[-0.13,0.5]].forEach(([ox,oz],i) => {
                        const roll = new THREE.Mesh(new THREE.SphereGeometry(0.33,10,7), mat(0xc8832a,0.85));
                        roll.scale.set(1,0.68,1);
                        roll.position.set(bx+ox*0.78, tableTopY+0.32+(i>2?0.38:0), bz+oz*0.78);
                        foodGroup.add(roll);
                        const sc = new THREE.Mesh(new THREE.TorusGeometry(0.16,0.022,4,12,Math.PI), mat(0x9e5f10,0.9));
                        sc.rotation.x = -Math.PI/2;
                        sc.position.set(roll.position.x, roll.position.y+0.21, roll.position.z);
                        foodGroup.add(sc);
                    });
                }

                else if (label === 'chips') {
                    const geo = new THREE.LatheGeometry([
                        new THREE.Vector2(0,0),new THREE.Vector2(0.9,0.1),
                        new THREE.Vector2(1.3,0.38),new THREE.Vector2(1.22,0.72)
                    ], 24);
                    const bowl = new THREE.Mesh(geo, mat(0xf5e6c8,0.5,0.05));
                    bowl.position.set(bx, tableTopY, bz);
                    bowl.scale.setScalar(0.75);
                    foodGroup.add(bowl);
                    // inner bottom cap (LatheGeometry bottom face has downward normals — add upward-facing cap)
                    const chipCap = new THREE.Mesh(new THREE.CircleGeometry(0.68, 24), mat(0xf5e6c8,0.5,0.05));
                    chipCap.rotation.x = -Math.PI / 2;
                    chipCap.position.set(bx, tableTopY + 0.076, bz);
                    foodGroup.add(chipCap);
                    for (let i = 0; i < 14; i++) {
                        const a = (i/14)*Math.PI*2 + (i%3)*0.18;
                        const chipShape = new THREE.Shape();
                        for (let v = 0; v < 5; v++) {
                            const va = (v/5)*Math.PI*2;
                            v===0 ? chipShape.moveTo(Math.cos(va)*(0.25+(v%2)*0.09), Math.sin(va)*(0.18+(v%2)*0.07))
                                  : chipShape.lineTo(Math.cos(va)*(0.25+(v%2)*0.09), Math.sin(va)*(0.18+(v%2)*0.07));
                        }
                        chipShape.closePath();
                        const chip = new THREE.Mesh(new THREE.ExtrudeGeometry(chipShape,{depth:0.032,bevelEnabled:false}), mat(0xf4c06e,0.8));
                        const r = 0.28+(i%4)*0.1;
                        chip.position.set(bx+Math.cos(a)*r, tableTopY+0.3+(i%3)*0.09, bz+Math.sin(a)*r);
                        chip.rotation.set((i%3)*0.22-0.11, a, (i%2)*0.18);
                        foodGroup.add(chip);
                    }
                }

                else if (label === 'veggie') {
                    makeBowl(bx, bz, 0.62, 0xe8e8e0);
                    [0xff6644,0x55bb33,0xeeee44,0xff4444,0x66dd66,0xff8844,0xaa44cc].forEach((c,i) => {
                        const a = (i/7)*Math.PI*2 + rotY;
                        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.11,0.55,8), mat(c,0.7));
                        v.rotation.set(Math.PI/2+0.28, a, 0);
                        v.position.set(bx+Math.cos(a)*0.42, tableTopY+0.5, bz+Math.sin(a)*0.42);
                        foodGroup.add(v);
                    });
                }

                else if (label === 'salsa') {
                    makeBowl(bx, bz, 0.58, 0xe2d0c0);
                    const surf = new THREE.Mesh(new THREE.CylinderGeometry(0.52,0.52,0.05,20), mat(0xcc2200,0.85));
                    surf.position.set(bx, tableTopY+0.56, bz);
                    foodGroup.add(surf);
                    for (let s = 0; s < 6; s++) {
                        const a = (s/6)*Math.PI*2;
                        const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.06,0.09), mat(s%2===0?0xff6644:0x55aa22,0.9));
                        chunk.position.set(bx+Math.cos(a)*0.26, tableTopY+0.62, bz+Math.sin(a)*0.26);
                        chunk.rotation.y = a;
                        foodGroup.add(chunk);
                    }
                }

                else if (label === 'guac') {
                    makeBowl(bx, bz, 0.56, 0xe2d8c8);
                    const gs = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.055,20), mat(0x5a9e28,0.9));
                    gs.position.set(bx, tableTopY+0.54, bz);
                    foodGroup.add(gs);
                    for (let g = 0; g < 5; g++) {
                        const a = (g/5)*Math.PI*2;
                        const sp = new THREE.Mesh(new THREE.SphereGeometry(0.05,4,4), mat(0x33aa22,0.9));
                        sp.position.set(bx+Math.cos(a)*0.2, tableTopY+0.61, bz+Math.sin(a)*0.2);
                        foodGroup.add(sp);
                    }
                }

                else if (label === 'cheese') {
                    const board = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.09,1.6), mat(0xb8863c,0.85));
                    board.position.set(bx, tableTopY+0.045, bz);
                    board.rotation.y = rotY;
                    foodGroup.add(board);
                    [{x:-0.6,z:0,c:0xffd966,w:0.62,h:0.3,d:0.44},
                     {x:0.28,z:-0.3,c:0xfff5cc,w:0.5,h:0.26,d:0.38},
                     {x:0.72,z:0.28,c:0xe8c87a,w:0.46,h:0.34,d:0.35}
                    ].forEach(({x,z,c,w,h,d}) => {
                        const wedge = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(c,0.6));
                        wedge.position.set(bx+x, tableTopY+0.09+h/2, bz+z);
                        wedge.rotation.y = rotY + (x+z)*0.3;
                        foodGroup.add(wedge);
                    });
                    const kh = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.85,8), mat(0x4a2f1a,0.7));
                    kh.rotation.z = Math.PI/2;
                    kh.position.set(bx-0.45, tableTopY+0.17, bz+0.5);
                    foodGroup.add(kh);
                    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.78,0.036,0.11), mat(0xcccccc,0.3,0.8));
                    kb.position.set(bx+0.12, tableTopY+0.17, bz+0.5);
                    foodGroup.add(kb);
                }

                else if (label === 'punch') {
                    const geo = new THREE.LatheGeometry([
                        new THREE.Vector2(0,0),new THREE.Vector2(1.0,0.18),
                        new THREE.Vector2(1.45,0.72),new THREE.Vector2(1.48,1.3),new THREE.Vector2(1.4,1.44)
                    ], 28);
                    const pb = new THREE.Mesh(geo, mat(0xd8eeff,0.35,0.15));
                    pb.position.set(bx, tableTopY, bz);
                    pb.scale.setScalar(0.82);
                    foodGroup.add(pb);
                    const pl = new THREE.Mesh(new THREE.CylinderGeometry(1.08,1.08,0.07,28), mat(0xdd3366,0.4,0.05));
                    pl.position.set(bx, tableTopY+1.06, bz);
                    foodGroup.add(pl);
                    for (let f = 0; f < 5; f++) {
                        const a = (f/5)*Math.PI*2;
                        const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,0.055,12), mat(0xff8833,0.6));
                        sl.position.set(bx+Math.cos(a)*0.62, tableTopY+1.12, bz+Math.sin(a)*0.62);
                        foodGroup.add(sl);
                    }
                    const lh = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,2.0,8), mat(0xaaaaaa,0.4,0.6));
                    lh.rotation.z = Math.PI/4;
                    lh.position.set(bx+0.62, tableTopY+1.7, bz);
                    foodGroup.add(lh);
                }

                else if (label === 'sandwich') {
                    const tray = new THREE.Mesh(new THREE.CylinderGeometry(1.18,1.22,0.06,24), mat(0xeeeeee,0.55,0.15));
                    tray.position.set(bx, tableTopY+0.03, bz);
                    tray.rotation.y = rotY;
                    foodGroup.add(tray);
                    [[-0.5,-0.3],[0.5,-0.3],[0,-0.55],[0.55,0.2],[-0.55,0.2],[0,0.45]].forEach(([ox,oz],i) => {
                        const sh = new THREE.Shape();
                        sh.moveTo(0,0.3); sh.lineTo(-0.26,-0.18); sh.lineTo(0.26,-0.18); sh.closePath();
                        const sand = new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:0.22,bevelEnabled:false}), mat(i%2===0?0xf5d980:0xd4a855,0.7));
                        sand.position.set(bx+ox, tableTopY+0.06, bz+oz);
                        sand.rotation.x = Math.PI/2;
                        sand.rotation.z = rotY + (i/6)*Math.PI*2;
                        foodGroup.add(sand);
                    });
                }

                else if (label === 'pitcher') {
                    const pitcherGeo = new THREE.LatheGeometry([
                        new THREE.Vector2(0,0),new THREE.Vector2(0.5,0.05),
                        new THREE.Vector2(0.55,0.8),new THREE.Vector2(0.6,1.5),
                        new THREE.Vector2(0.5,1.7),new THREE.Vector2(0.45,1.85),new THREE.Vector2(0.52,2.0)
                    ], 20);
                    const pitcher = new THREE.Mesh(pitcherGeo, mat(0xccddff,0.1,0.05));
                    pitcher.material.transparent = true;
                    pitcher.material.opacity = 0.75;
                    pitcher.position.set(bx, tableTopY, bz);
                    pitcher.scale.setScalar(0.7);
                    pitcher.rotation.y = rotY;
                    foodGroup.add(pitcher);
                    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.36,0.36,0.06,20), mat(0x8899ff,0.2,0.05));
                    water.position.set(bx, tableTopY+1.1, bz);
                    foodGroup.add(water);
                    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.28,0.05,8,14,Math.PI), mat(0xaabbdd,0.3,0.1));
                    handle.position.set(bx+0.48, tableTopY+0.9, bz);
                    handle.rotation.y = Math.PI/2 + rotY;
                    foodGroup.add(handle);
                }

                else if (label === 'candy') {
                    makeBowl(bx, bz, 0.55, 0xf0e8d0);
                    const candyColors = [0xff2244,0x2244ff,0x22cc44,0xffcc00,0xff6600,0xcc22cc];
                    for (let i = 0; i < 16; i++) {
                        const a = (i/16)*Math.PI*2 + (i%2)*0.2;
                        const r = 0.15+(i%4)*0.12;
                        const candy = new THREE.Mesh(new THREE.SphereGeometry(0.1,6,5), mat(candyColors[i%candyColors.length],0.4,0.2));
                        candy.position.set(bx+Math.cos(a)*r, tableTopY+0.42+Math.floor(i/8)*0.2, bz+Math.sin(a)*r);
                        foodGroup.add(candy);
                    }
                }

                else if (label === 'cookies') {
                    const tray = new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.1,0.07,24), mat(0xdddddd,0.6,0.2));
                    tray.position.set(bx, tableTopY+0.035, bz);
                    foodGroup.add(tray);
                    const cc = [0xc8732a,0xe8d5a0,0xaa3311,0xf0c060,0xddaa44,0xcc6622,0xf8e0b0];
                    for (let i = 0; i < 7; i++) {
                        const a = (i/7)*Math.PI*2;
                        const r = i < 3 ? 0.3 : 0.65;
                        const cookie = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.09,12), mat(cc[i],0.75));
                        cookie.position.set(bx+Math.cos(a)*r, tableTopY+0.09, bz+Math.sin(a)*r);
                        foodGroup.add(cookie);
                        for (let d = 0; d < 3; d++) {
                            const da = a + d*(Math.PI*2/3);
                            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035,4,4), mat(0x3a1a00,0.9));
                            dot.position.set(bx+Math.cos(a)*r+Math.cos(da)*0.1, tableTopY+0.14, bz+Math.sin(a)*r+Math.sin(da)*0.1);
                            foodGroup.add(dot);
                        }
                    }
                }

                else if (label === 'plates') {
                    const pc = [0xfafafa,0xf5f5f0,0xffffff];
                    for (let i = 0; i < 10; i++) {
                        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.98-i*0.004,1.02-i*0.004,0.052,24), mat(pc[i%pc.length],0.9));
                        p.position.set(bx, tableTopY+0.052*i+0.026, bz);
                        foodGroup.add(p);
                    }
                    const pr = new THREE.Mesh(new THREE.TorusGeometry(0.94,0.052,6,24), mat(0xeeeeee,0.9));
                    pr.rotation.x = Math.PI/2;
                    pr.position.set(bx, tableTopY+0.052*10+0.028, bz);
                    foodGroup.add(pr);
                }

                else if (label === 'cups') {
                    for (let i = 0; i < 7; i++) {
                        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.32+i*0.016,0.24+i*0.012,0.54,16,1,true), mat(i%2===0?0xffffff:0xddeeff,0.85));
                        cup.position.set(bx, tableTopY+0.46*i+0.26, bz);
                        foodGroup.add(cup);
                    }
                    const tr = new THREE.Mesh(new THREE.TorusGeometry(0.43,0.035,6,16), mat(0xdddddd,0.7));
                    tr.rotation.x = Math.PI/2;
                    tr.position.set(bx, tableTopY+0.46*7+0.5, bz);
                    foodGroup.add(tr);
                }

                else if (label === 'napkins') {
                    for (let n = 0; n < 14; n++) {
                        const nap = new THREE.Mesh(new THREE.BoxGeometry(0.88,0.042,0.88), mat(0xfff8f0,0.95));
                        nap.position.set(bx, tableTopY+0.042*n+0.021, bz);
                        nap.rotation.y = rotY + (n%2)*0.055 - 0.027;
                        foodGroup.add(nap);
                    }
                    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46,0.065,5,20), mat(0xc8a055,0.6,0.3));
                    ring.rotation.x = Math.PI/2;
                    ring.position.set(bx, tableTopY+0.042*7, bz);
                    foodGroup.add(ring);
                }

                else if (label === 'cupcakes') {
                    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.15,0.08,24), mat(0xffffff,0.5,0.3));
                    base.position.set(bx, tableTopY+0.04, bz);
                    foodGroup.add(base);
                    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1.0,10), mat(0xcccccc,0.4,0.6));
                    pole.position.set(bx, tableTopY+0.58, bz);
                    foodGroup.add(pole);
                    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.72,0.06,20), mat(0xffffff,0.5,0.3));
                    top.position.set(bx, tableTopY+1.1, bz);
                    foodGroup.add(top);
                    const cakeCols = [0xff88aa,0x88aaff,0xffcc44,0xaa88ff,0x88ddaa,0xff7744];
                    for (let i = 0; i < 6; i++) {
                        const a = (i/6)*Math.PI*2;
                        const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.22,0.26,10), mat(0xf5e6c8,0.8));
                        cb.position.set(bx+Math.cos(a)*0.72, tableTopY+0.22, bz+Math.sin(a)*0.72);
                        foodGroup.add(cb);
                        const fr = new THREE.Mesh(new THREE.SphereGeometry(0.2,8,6), mat(cakeCols[i],0.6));
                        fr.scale.set(1,0.7,1);
                        fr.position.set(bx+Math.cos(a)*0.72, tableTopY+0.42, bz+Math.sin(a)*0.72);
                        foodGroup.add(fr);
                    }
                    for (let i = 0; i < 4; i++) {
                        const a = (i/4)*Math.PI*2 + 0.4;
                        const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.2,0.22,10), mat(0xf5e6c8,0.8));
                        cb.position.set(bx+Math.cos(a)*0.42, tableTopY+1.22, bz+Math.sin(a)*0.42);
                        foodGroup.add(cb);
                        const fr = new THREE.Mesh(new THREE.SphereGeometry(0.18,8,6), mat(cakeCols[(i+3)%6],0.6));
                        fr.scale.set(1,0.7,1);
                        fr.position.set(bx+Math.cos(a)*0.42, tableTopY+1.4, bz+Math.sin(a)*0.42);
                        foodGroup.add(fr);
                    }
                }
            });

            console.log('Added procedural food items to table');
        }

        function makePedestal(x, y, z, w, h, d, rotY) {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(w, h, d),
                pedestalMaterial
            );
            mesh.position.set(x, y + h / 2, z);
            if (rotY) mesh.rotation.y = rotY;
            scene.add(mesh);
            addObjectCollider(mesh);
        }

        function addBackdoorToScene() {
            if (!models.backdoor) {
                console.warn('Backdoor model not loaded yet');
                return;
            }

            // Clone and add the backdoor model to the scene
            const clonedBackdoor = models.backdoor.clone();
            clonedBackdoor.position.set(30, 10, -142);
            clonedBackdoor.scale.set(25, 25, 25);
           // clonedBackdoor.rotation.y = 180 * (Math.PI / 180); // Rotate 180 degrees to face the correct direction
            
            applyGLBMaterials(clonedBackdoor);
            scene.add(clonedBackdoor);
            console.log('Added backdoor model to scene');
        }

        function replaceWindowsWithModel(model) {
            if (!models.window) {
                console.warn('Window model not loaded yet');
                return;
            }

            model.traverse((child) => {
                if (child.isMesh) {
                    const name = child.name.toLowerCase();
                    if (name.includes('window') || name.includes('glass')) {
                        // Get the window mesh's world transform
                        child.updateWorldMatrix(true, false);
                        const bbox = new THREE.Box3().setFromObject(child);
                        const size = bbox.getSize(new THREE.Vector3());
                        const center = bbox.getCenter(new THREE.Vector3());

                        // Determine which axis is the thin/normal axis
                        const minAxis = size.x < size.z ? 'x' : 'z';
                        const offset = 0.1;

                        // Add window models on both sides (inside and outside)
                        [-1, 1].forEach((side) => {
                            // Clone window without clipping planes
                            const clonedWindow = models.window.clone();
                            clonedWindow.applyMatrix4(child.matrixWorld);
                            clonedWindow.scale.set(13, 13, 5);
                            clonedWindow.rotation.x = Math.PI; // Rotate 180 degrees to face the correct direction    
                            // Offset the window slightly in the normal direction
                            if (minAxis === 'x') {
                                clonedWindow.position.x += side * offset;
                            } else {
                                clonedWindow.position.z += side * offset;
                            }

                            clonedWindow.position.z += .2; // Adjust for model's original position
                           // clonedWindow.position.y -= 3; // Adjust for model's original position
                            // Remove clipping planes from all window materials
                            clonedWindow.traverse((childWindow) => {
                                if (childWindow.isMesh && childWindow.material) {
                                    const mats = Array.isArray(childWindow.material) ? childWindow.material : [childWindow.material];
                                    mats.forEach(mat => {
                                        if (mat) {
                                            mat.clippingPlanes = null;
                                        }
                                    });
                                }
                            });

                            scene.add(clonedWindow);
                        });
                        
                        console.log('Added window models to:', child.name);
                    }
                }
            });
        }

        function colorizeModel(model) {
            model.traverse((child) => {
                if (child.isMesh) {
                    const name = child.name.toLowerCase();

                    if (child.name === 'Opening0') {
                        child.material = skyBlueMaterial;
                        child.visible = true;
                        child.scale.set(1.2, 2.3, .1); // Elongate the pedestal to better fit the opening
                        child.position.x += 0.1; // Slightly raise the pedestal to prevent z-fighting
                    } else if (child.name === 'Door0' || child.name === 'Door1') {
                        child.visible = false;
                    } else if (child.name === 'Window0') {
                        child.visible = false;
                    } else if (child.name === 'Wall3' || child.name === 'Wall4' || child.name === 'Wall5') {
                        child.visible = false;
                    } else if (child.name === 'Wall7' || child.name === 'Wall8' || child.name === 'Wall9') {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wallpaperMaterial);
                    } else if (child.name === 'Wall11') {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wallpaperMaterial);
                    }
                    else if (child.name === 'Wall16') {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wallpaperMaterial);
                    } else if (name.includes('door')/* && name.includes('wall16')*/) {
                        child.visible = false;
                    } else if (name.includes('door')) {
                        child.material = yellowMaterial;
                    } else if (name.includes('window') || name.includes('glass')) {
                        child.material = greenMaterial;
                    } else if (child.name === 'Wall1' || child.name === 'Wall6') {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wall1Material);
                    } else {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wallpaperMaterial);
                    }
                }
            });
        }

        // =====================================================
        // WALL VISUALIZATION FOR DEBUGGING
        // =====================================================
        
        // =====================================================
        // DEBUG MODE - Labels for walls, doors, windows
        // =====================================================
        
        let debugLabelsGroup = new THREE.Group();
        scene.add(debugLabelsGroup);
        let debugMode = false;
        const manualWalls = []; // Wall20, Wall21, … added programmatically
        
        function createTextTexture(text) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            return texture;
        }
        
        function createLabel(position, text) {
            const texture = createTextTexture(text);
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.position.copy(position);
            sprite.scale.set(10, 2.5, 1);
            return sprite;
        }
        
        function updateDebugLabels(model) {
            debugLabelsGroup.clear();
            if (!debugMode) return;

            // Label manually-added walls (Wall20, Wall21, …)
            for (const wall of manualWalls) {
                const bbox = new THREE.Box3().setFromObject(wall);
                const center = bbox.getCenter(new THREE.Vector3());
                center.y += 16;
                debugLabelsGroup.add(createLabel(center, 'Wall: ' + wall.name));
            }
            
            model.traverse((child) => {
                if (child.isMesh) {
                    const name = child.name.toLowerCase();
                    const bbox = new THREE.Box3().setFromObject(child);
                    const center = bbox.getCenter(new THREE.Vector3());
                    center.y += 16; // Raise labels above the objects
                    
                    if (name.includes('door')) {
                        const label = createLabel(center, 'Door: ' + child.name);
                        debugLabelsGroup.add(label);
                    } else if (name.includes('window') || name.includes('glass')) {
                        const label = createLabel(center, 'Window: ' + child.name);
                        debugLabelsGroup.add(label);
                    } else if (name.includes('wall') || name.includes('panel')) {
                        const label = createLabel(center, 'Wall: ' + child.name);
                        debugLabelsGroup.add(label);
                    }
                }
            });
        }

        // =====================================================
        // COLLISION DETECTION
        // =====================================================

        // Register a world-space AABB collider for any scene object.
        // Skips objects whose XZ footprint is smaller than minSize (e.g. books on a table).
        function addObjectCollider(obj, minSize = 0.8) {
            obj.updateWorldMatrix(true, true);
            const bbox = new THREE.Box3().setFromObject(obj);
            const sz = bbox.getSize(new THREE.Vector3());
            if (sz.x >= minSize || sz.z >= minSize) {
                wallColliders.push(bbox);
            }
        }
        
        function checkCollision(x, z) {
            // Player collision radius (for proximity checking)
            const playerRadius = 1.5;
            
            // Check collision with walls
            for (let wall of wallColliders) {
                // Expand wall box by player radius for collision detection
                const expandedMin = new THREE.Vector3(
                    wall.min.x - playerRadius,
                    wall.min.y,
                    wall.min.z - playerRadius
                );
                const expandedMax = new THREE.Vector3(
                    wall.max.x + playerRadius,
                    wall.max.y,
                    wall.max.z + playerRadius
                );
                
                // Check if camera position is inside expanded wall box
                if (x >= expandedMin.x && x <= expandedMax.x &&
                    z >= expandedMin.z && z <= expandedMax.z) {
                    return true; // Collision detected
                }
            }
            
            return false; // No collision
        }

        // =====================================================
        // CUSTOM POINTER LOCK CONTROLS
        // =====================================================
        
        let pitch = 0;
        let yaw = 0;
        let pendingDX = 0, pendingDY = 0; // accumulated raw mouse deltas, flushed each frame
        
        const pointerSpeed = 0.004;
        const _euler = new THREE.Euler(0, 0, 0, 'YXZ'); // reused — avoids per-event allocation
        
        document.addEventListener('click', () => {
            if (currentMode === 'game') {
                if (!pointerLockReady) {
                    pointerLockReady = true; // first click arms the lock
                    return;
                }
                document.body.requestPointerLock();
            }
        });

        let lockAcquiredAt = 0;

        document.addEventListener('pointerlockchange', () => {
            isLocked = !!document.pointerLockElement;
            if (isLocked) {
                lockAcquiredAt = performance.now(); // Record time to suppress post-lock inertia
                document.getElementById('info').style.opacity = '0.3';
            } else {
                document.getElementById('info').style.opacity = '1';
            }
        });

        document.addEventListener('mousemove', (event) => {
            if (currentMode === 'game') {
                if (!isLocked) return;
                // Ignore movement for 300ms after lock to absorb click/trackpad inertia
                if (performance.now() - lockAcquiredAt < 300) return;
                // Accumulate raw (unrounded) deltas — flushed each rAF to avoid jitter
                pendingDX += event.movementX;
                pendingDY += event.movementY;
                needsRender = true;
            } else {
                // Explore mode: left drag = orbit, right/middle/shift = pan
                const isPan = event.buttons === 2 || event.buttons === 4 ||
                              (event.buttons === 1 && event.shiftKey);
                const isOrbit = event.buttons === 1 && !event.shiftKey;
                if (isPan || isOrbit) {
                    const dx = event.clientX - lastExploreMousePos.x;
                    const dy = event.clientY - lastExploreMousePos.y;
                    if (isPan) {
                        // Screen-space pan: move orbit target in camera's right/up plane
                        const phi   = exploreRotation.x;
                        const theta = exploreRotation.y;
                        const panScale = exploreCameraDistance * 0.0012;
                        // Camera right in world space: (cos θ, 0, -sin θ)
                        const rX =  Math.cos(theta);
                        const rZ = -Math.sin(theta);
                        // Camera up in world space: (-sin θ sin φ, cos φ, -cos θ sin φ)
                        const uX = -Math.sin(theta) * Math.sin(phi);
                        const uY =  Math.cos(phi);
                        const uZ = -Math.cos(theta) * Math.sin(phi);
                        exploreCameraPan.x  -= (rX * dx - uX * dy) * panScale;
                        exploreCameraPanY   += uY * dy * panScale;
                        exploreCameraPan.y  -= (rZ * dx - uZ * dy) * panScale;
                    } else {
                        // Orbit: rotate around target
                        exploreRotation.x += dy * 0.005;
                        exploreRotation.y += dx * 0.005;
                        exploreRotation.x = Math.max(-0.2, Math.min(Math.PI / 2 * 0.97, exploreRotation.x));
                    }
                    needsRender = true;
                }
                lastExploreMousePos.set(event.clientX, event.clientY);
            }
        });
        
        document.addEventListener('contextmenu', (event) => {
            if (currentMode === 'explore') event.preventDefault();
        });

        document.addEventListener('wheel', (event) => {
            if (currentMode === 'explore') {
                event.preventDefault();
                // Proportional zoom — same relative speed at any distance
                exploreCameraDistance *= 1 + event.deltaY * 0.001;
                exploreCameraDistance = Math.max(5, Math.min(300, exploreCameraDistance));
                needsRender = true;
            }
        }, { passive: false });
        
        // Touch support for explore mode
        let lastTouchDistance = 0;
        let lastTouchPos = new THREE.Vector2(0, 0);
        
        document.addEventListener('touchmove', (event) => {
            if (currentMode !== 'explore') return;
            event.preventDefault();
            
            if (event.touches.length === 2) {
                // Two-finger: pinch to zoom + drag to pan
                const touch1 = event.touches[0];
                const touch2 = event.touches[1];
                const midX = (touch1.clientX + touch2.clientX) / 2;
                const midY = (touch1.clientY + touch2.clientY) / 2;

                const currentDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );

                if (lastTouchDistance > 0) {
                    // Proportional pinch zoom
                    exploreCameraDistance *= lastTouchDistance / currentDistance;
                    exploreCameraDistance = Math.max(5, Math.min(300, exploreCameraDistance));
                }
                lastTouchDistance = currentDistance;

                // Two-finger drag = pan (screen-space)
                const phi   = exploreRotation.x;
                const theta = exploreRotation.y;
                const dx = midX - lastTouchPos.x;
                const dy = midY - lastTouchPos.y;
                const panScale = exploreCameraDistance * 0.0012;
                const rX =  Math.cos(theta);
                const rZ = -Math.sin(theta);
                const uX = -Math.sin(theta) * Math.sin(phi);
                const uY =  Math.cos(phi);
                const uZ = -Math.cos(theta) * Math.sin(phi);
                exploreCameraPan.x  -= (rX * dx - uX * dy) * panScale;
                exploreCameraPanY   += uY * dy * panScale;
                exploreCameraPan.y  -= (rZ * dx - uZ * dy) * panScale;

                lastTouchPos.set(midX, midY);
                needsRender = true;
            } else if (event.touches.length === 1) {
                // Single finger = orbit
                const touch = event.touches[0];
                const deltaMove = new THREE.Vector2(
                    touch.clientX - lastTouchPos.x,
                    touch.clientY - lastTouchPos.y
                );
                exploreRotation.x += deltaMove.y * 0.005;
                exploreRotation.y += deltaMove.x * 0.005;
                exploreRotation.x = Math.max(-0.2, Math.min(Math.PI / 2 * 0.97, exploreRotation.x));
                lastTouchPos.set(touch.clientX, touch.clientY);
                needsRender = true;
            }
        }, { passive: false });
        
        document.addEventListener('touchstart', (event) => {
            if (currentMode !== 'explore') return;
            
            if (event.touches.length === 2) {
                // Calculate initial distance for pinch zoom
                const touch1 = event.touches[0];
                const touch2 = event.touches[1];
                lastTouchDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                lastTouchPos.set(
                    (touch1.clientX + touch2.clientX) / 2,
                    (touch1.clientY + touch2.clientY) / 2
                );
            } else if (event.touches.length === 1) {
                const touch = event.touches[0];
                lastTouchPos.set(touch.clientX, touch.clientY);
            }
        });
        
        document.addEventListener('touchend', (event) => {
            if (event.touches.length < 2) {
                lastTouchDistance = 0;
            }
        });

        // Movement
        const moveSpeed = 0.25;
        const turnSpeed = 0.04;

        const moveState = {
            forward: false,
            backward: false,
            left: false,
            right: false
        };

        document.addEventListener('keydown', (event) => {
            if (currentMode === 'game') {
                switch (event.code) {
                    case 'ArrowUp':
                    case 'KeyW':
                        moveState.forward = true;
                        break;
                    case 'ArrowDown':
                    case 'KeyS':
                        moveState.backward = true;
                        break;
                    case 'ArrowLeft':
                    case 'KeyA':
                        moveState.left = true;
                        break;
                    case 'ArrowRight':
                    case 'KeyD':
                        moveState.right = true;
                        break;
                }
            }
            if (event.code === 'Escape') {
                if (document.pointerLockElement) {
                    document.exitPointerLock();
                }
            }
        });

        document.addEventListener('keyup', (event) => {
            if (currentMode === 'game') {
                switch (event.code) {
                    case 'ArrowUp':
                    case 'KeyW':
                        moveState.forward = false;
                        break;
                    case 'ArrowDown':
                    case 'KeyS':
                        moveState.backward = false;
                        break;
                    case 'ArrowLeft':
                    case 'KeyA':
                        moveState.left = false;
                        break;
                    case 'ArrowRight':
                    case 'KeyD':
                        moveState.right = false;
                        break;
                }
            }
        });

        // Clear movement state when window loses focus to prevent stuck keys
        window.addEventListener('blur', () => {
            moveState.forward = false;
            moveState.backward = false;
            moveState.left = false;
            moveState.right = false;
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                moveState.forward = false;
                moveState.backward = false;
                moveState.left = false;
                moveState.right = false;
            }
        });

        // =====================================================
        // ANIMATION LOOP
        // =====================================================
        
        let prevTime = performance.now();

        function updateCamera(delta) {
            if (currentMode === 'game') {
                let moveStep = 0;
                let turned = false;
                
                // Forward/backward movement in facing direction
                if (moveState.forward) moveStep -= moveSpeed * delta * 60;
                if (moveState.backward) moveStep += moveSpeed * delta * 60;
                
                if (moveStep !== 0) {
                    const nextX = camera.position.x + Math.sin(yaw) * moveStep;
                    const nextZ = camera.position.z + Math.cos(yaw) * moveStep;
                    
                    // Check collision before moving
                    if (!checkCollision(nextX, nextZ)) {
                        camera.position.x = nextX;
                        camera.position.z = nextZ;
                        needsRender = true;
                    }
                }
                
                // Turn left/right
                if (moveState.left) {
                    yaw += turnSpeed * delta * 60;
                    turned = true;
                    needsRender = true;
                }
                if (moveState.right) {
                    yaw -= turnSpeed * delta * 60;
                    turned = true;
                    needsRender = true;
                }
                
                // Update camera rotation if turned
                if (turned || moveStep !== 0) {
                    _euler.set(pitch, yaw, 0, 'YXZ');
                    camera.quaternion.setFromEuler(_euler);
                }
                
                // Keep camera at eye height
                camera.position.y = 10;
            } else {
                // Explore mode: orbit camera around center
                const centerX = exploreCameraPan.x;
                const centerY = 5 + exploreCameraPanY;
                const centerZ = exploreCameraPan.y;
                
                const x = centerX + Math.sin(exploreRotation.y) * Math.cos(exploreRotation.x) * exploreCameraDistance;
                const y = centerY + Math.sin(exploreRotation.x) * exploreCameraDistance;
                const z = centerZ + Math.cos(exploreRotation.y) * Math.cos(exploreRotation.x) * exploreCameraDistance;
                
                camera.position.set(x, y, z);
                camera.lookAt(centerX, centerY, centerZ);
            }
        }

        // =====================================================
        // AUDIO OCCLUSION — raycast through wallColliders each 6 frames
        // =====================================================
        let _occlusionTick = 0;
        const _rayOccl = new THREE.Ray();
        const _hitOccl = new THREE.Vector3();
        const _toSound = new THREE.Vector3();

        function updateAudioOcclusion() {
            if (positionalAudios.length === 0 || wallColliders.length === 0) return;
            if (++_occlusionTick % 6 !== 0) return;  // Only check every 6 frames

            const camPos = camera.position;
            positionalAudios.forEach(sound => {
                sound.getWorldPosition(_toSound);
                const dist = camPos.distanceTo(_toSound);
                _rayOccl.origin.copy(camPos);
                _rayOccl.direction.subVectors(_toSound, camPos).normalize();

                let wallCount = 0;
                for (const box of wallColliders) {
                    if (_rayOccl.intersectBox(box, _hitOccl)) {
                        // Only count walls between camera and source
                        if (camPos.distanceTo(_hitOccl) < dist) wallCount++;
                    }
                }

                // Each wall halves volume (0.5^n) and narrows low-pass by 1.5 octaves
                const baseVol = sound._baseVolume ?? 1;
                const vol = baseVol * Math.pow(0.5, wallCount);
                const freq = wallCount > 0 ? Math.max(300, 20000 / Math.pow(2, wallCount * 1.5)) : 20000;
                sound.setVolume(vol);
                if (sound._wallFilter) {
                    sound._wallFilter.frequency.setTargetAtTime(
                        freq, audioListener.context.currentTime, 0.08
                    );
                }
            });
        }

        function animate() {
            const time = performance.now();
            const delta = (time - prevTime) / 1000;

            // ── Video optimisation: distance-based pause/resume ────────────────
            // Runs once per animation frame regardless of mode.  Pausing distant
            // videos stops the browser decoder and eliminates their GPU texture
            // uploads completely.  For videos without requestVideoFrameCallback
            // we also drive needsRender here so the shared loop (not N separate
            // RAF chains) keeps the screen refreshing while they play.
            if (videoObjects.length > 0) {
                const camPos = camera.position;
                for (const vo of videoObjects) {
                    const worldPos = vo.plane.getWorldPosition(_videoTmpVec);
                    vo._distant = camPos.distanceTo(worldPos) > VIDEO_PAUSE_DISTANCE;
                    // Video keeps playing regardless of distance — audio stays in
                    // sync automatically; only the GPU texture upload is gated.
                    // Fallback path (no requestVideoFrameCallback): signal a render
                    // only when the plane is close enough to be worth updating.
                    if (!vo._distant
                            && typeof vo.video.requestVideoFrameCallback !== 'function'
                            && !vo.video.paused && !vo.video.ended) {
                        needsRender = true;
                    }
                }
            }
            // ──────────────────────────────────────────────────────────────────

            if (currentMode === 'game') {
                if (isLocked || renderer.xr.isPresenting) {
                    // Flush accumulated mouse deltas once per frame (smooth, no rounding jitter)
                    if (pendingDX !== 0 || pendingDY !== 0) {
                        const PI_2 = Math.PI / 2;
                        yaw   -= pendingDX * pointerSpeed;
                        pitch -= pendingDY * pointerSpeed;
                        pitch  = Math.max(-PI_2, Math.min(PI_2, pitch));
                        _euler.set(pitch, yaw, 0, 'YXZ');
                        camera.quaternion.setFromEuler(_euler);
                        pendingDX = 0;
                        pendingDY = 0;
                    }
                    updateCamera(delta);
                }
                
                // Render only when something changed (or every frame in VR)
                if (renderer.xr.isPresenting || needsRender) {
                    needsRender = false;
                    renderer.render(scene, camera);
                }

                updateAudioOcclusion();  // Raycast walls every 6 frames to adjust volume/filter
            } else {
                // Explore mode: only update camera and render if state changed
                if (needsRender) {
                    updateCamera(delta);
                    renderer.render(scene, camera);
                    needsRender = false;
                }
            }

            prevTime = time;
        }

        renderer.setAnimationLoop(animate);

        // Handle window resize
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            needsRender = true;
        });

        // Create brick facades for the 4 sides of the building
        const frontFacade = createBrickFacade(46.6, 30, 0.5);
        frontFacade.position.set(-20.38, 12.5, 32.8);
        scene.add(frontFacade);
        addObjectCollider(frontFacade);

        const backFacade = createBrickFacade(85.35, 30, 0.02);
        backFacade.position.set(-.9, 12.5, -142.5);
        backFacade.rotation.y = Math.PI;
        scene.add(backFacade);
        addObjectCollider(backFacade);

        const leftFacade = createBrickFacade(175.5, 30, 0.5);
        leftFacade.position.set(-43.6, 12.5, -54.7);
        leftFacade.rotation.y = -Math.PI/2;
        scene.add(leftFacade);
        addObjectCollider(leftFacade);

        const rightFacade = createBrickFacade(185.8, 30, 0.2);
        rightFacade.position.set(41.4, 12.5, -49.45);
        rightFacade.rotation.y = Math.PI / 2;
        scene.add(rightFacade);
        addObjectCollider(rightFacade);

        // ── Manual walls ─────────────────────────────────────────────────────
        // Adjust position / rotation / scale below to place each wall.
        (function addManualWalls() {
            const wallMat = wallpaperMaterial.clone();

            const wall20 = new THREE.Mesh(new THREE.BoxGeometry(65, 30, 4), wallMat.clone());
            wall20.name = 'Wall20';
            wall20.position.set(7, 13, -87);  
            wall20.rotation.set(0, 0, 0);    
            scene.add(wall20);
            addObjectCollider(wall20);
            manualWalls.push(wall20);

            const wall21 = new THREE.Mesh(new THREE.BoxGeometry(42, 30, 3.4), wallMat.clone());
            wall21.name = 'Wall21';
            wall21.position.set(-4, 13, -110);   // ← adjust
            wall21.rotation.set(0, 90 * Math.PI / 180, 0);     // ← adjust
            scene.add(wall21);
            addObjectCollider(wall21);
            manualWalls.push(wall21);


             const wallHidden = new THREE.Mesh(new THREE.BoxGeometry(64.5, 0.3, 8.4), wallMat.clone());
            wallHidden.name = 'WallHidden';
            wallHidden.position.set(-11, 27, -19);  
            wallHidden.rotation.set(0, 0, 0);    
            scene.add(wallHidden);
        })();
        // ─────────────────────────────────────────────────────────────────────

        // Hide loading and start
        document.getElementById('loading').style.display = 'none';
        loadShow();

        // =====================================================
        // SHOW LOADING FUNCTIONS
        // =====================================================

        function addItemLight(object) {
            // No per-item spotlights - using gallery-wide lighting instead
        }

        function getWallMesh(wallName) {
            if (!wallName || wallName === 'none') return null;
            // Check manually-added walls (Wall20, Wall21, …) first
            const manual = manualWalls.find(w => w.name === wallName);
            if (manual) return manual;
            if (!modelScene) return null;
            let wallMesh = null;
            modelScene.traverse(child => { if (child.name === wallName) wallMesh = child; });
            return wallMesh;
        }

        function positionOnWall(object, item) {
            const DEG2RAD = Math.PI / 180;
            if (item.wall === 'none' || !item.wall) {
                // Direct positioning (e.g., on floor)
                object.position.set(item.position.x, item.position.y, item.position.z);
                object.rotation.set(item.rotation.x * DEG2RAD, item.rotation.y * DEG2RAD, item.rotation.z * DEG2RAD);
                return;
            }

            const wallMesh = getWallMesh(item.wall);
            if (!wallMesh) {
                console.warn('Wall not found:', item.wall);
                object.position.set(item.position.x, item.position.y, item.position.z);
                object.rotation.set(item.rotation.x * DEG2RAD, item.rotation.y * DEG2RAD, item.rotation.z * DEG2RAD);
                return;
            }

            wallMesh.updateWorldMatrix(true, false);
            const bbox = new THREE.Box3().setFromObject(wallMesh);
            const center = bbox.getCenter(new THREE.Vector3());
            const size = bbox.getSize(new THREE.Vector3());
            
            const minAxis = size.x < size.z ? 'x' : 'z';
            const autoSign = minAxis === 'x'
                ? (center.x > 0 ? -1 : 1)
                : (center.z > 0 ? -1 : 1);
            // item.face: 1 = default inward face, -1 = opposite face
            // Some walls default to the opposite face (e.g. Wall20 faces outward by default)
            const wallFaceDefaults = { Wall20: -1, Wall21: -1 };
            const effectiveFace = item.face !== undefined ? item.face : (wallFaceDefaults[item.wall] ?? 1);
            const inwardSign = (effectiveFace === -1) ? -autoSign : autoSign;
            
            if (minAxis === 'x') {
                object.rotation.y = inwardSign > 0 ? Math.PI / 2 : -Math.PI / 2;
            } else {
                object.rotation.y = inwardSign > 0 ? 0 : Math.PI;
            }
            
            object.rotation.x += item.rotation.x * DEG2RAD;
            object.rotation.y += item.rotation.y * DEG2RAD;
            object.rotation.z += item.rotation.z * DEG2RAD;

            const surfaceOffset = 0.1;
            object.position.set(
                center.x + item.position.x + (minAxis === 'x' ? inwardSign * (size.x / 2 + surfaceOffset) : 0),
                center.y + item.position.y,
                center.z + item.position.z + (minAxis === 'z' ? inwardSign * (size.z / 2 + surfaceOffset) : 0)
            );
        }

        function addImageToScene(item, showTitle) {
            const imageGroup = new THREE.Group();
            const material = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.01, metalness: 0.1, roughness: 0.8 });
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
           // plane.castShadow = true;  // Enable shadow casting
           // plane.receiveShadow = true;  // Enable shadow receiving
            imageGroup.add(plane);

            textureLoader.load('shows/' + showTitle + '/' + item.src, (tex) => {
                const imgW = tex.image.naturalWidth || tex.image.width;
                const imgH = tex.image.naturalHeight || tex.image.height;
                const aspect = imgW / imgH;
                const w = item.width || (item.height ? item.height * aspect : imgW);
                const h = item.height || w / aspect;
                
                plane.geometry.dispose();
                plane.geometry = new THREE.PlaneGeometry(w, h);

                // Apply texture settings for crisp, full-resolution appearance
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = renderer.capabilities.maxAnisotropy;

                material.map = tex;
                material.opacity = (item.opacity !== undefined) ? item.opacity : 1;
                material.needsUpdate = true;

                // Add frame if specified and not "none"
                if (item.frame && item.frame !== 'none') {
                    if (item.frame === 'fabric') {
                        // Draped tapestry: image printed on fabric, hanging from a wall rod
                        material.roughness = 0.93;
                        material.metalness = 0.0;
                        const fabricRepeatX = Math.max(1, w / 12);
                        const fabricRepeatY = Math.max(1, h / 12);
                        fabricNormalTexture.repeat.set(fabricRepeatX, fabricRepeatY);
                        material.normalMap = fabricNormalTexture;
                        material.normalScale = new THREE.Vector2(0.7, 0.7);
                        material.needsUpdate = true;

                        // Drape: replace flat plane with a subdivided mesh whose vertices are
                        // displaced to simulate vertical fabric folds + a gentle forward bow.
                        // Amplitudes are capped in world space so the fabric never pierces the wall.
                        const scaleMax = Math.max(item.scale.x, item.scale.y);
                        const foldAmp = Math.min(w * 0.02,          0.035 / scaleMax);
                        const bowAmp  = Math.min(Math.max(w, h) * 0.012, 0.020 / scaleMax);
                        const drapedGeo = new THREE.PlaneGeometry(w, h, 8, 24);
                        const pos = drapedGeo.attributes.position;
                        for (let i = 0; i < pos.count; i++) {
                            const nx = (pos.getX(i) / w) + 0.5;   // 0→1 left to right
                            const ny = (pos.getY(i) / h) + 0.5;   // 0→1 bottom to top
                            // Sinusoidal folds run vertically; amplitude tapers slightly toward top
                            const fold = Math.sin(nx * Math.PI * 5) * foldAmp * (1.0 - ny * 0.25);
                            // Catenary-style bow: fabric weight pulls centre forward
                            const bow  = Math.sin(ny * Math.PI) * bowAmp;
                            pos.setZ(i, fold + bow);
                        }
                        pos.needsUpdate = true;
                        drapedGeo.computeVertexNormals();
                        plane.geometry.dispose();
                        plane.geometry = drapedGeo;

                        // Dark wood hanging rod just above the top edge
                        const rodR = Math.max(w, h) * 0.008;
                        const rodW = w * 1.06;
                        const rodMat = new THREE.MeshStandardMaterial({ color: 0x2b1a0b, roughness: 0.72, metalness: 0.05 });
                        const rod = new THREE.Mesh(new THREE.CylinderGeometry(rodR, rodR, rodW, 10), rodMat);
                        rod.rotation.z = Math.PI / 2;
                        rod.position.set(0, h / 2 + rodR, rodR);
                        rod.castShadow = true;
                        imageGroup.add(rod);
                        // Decorative finial knobs at each end of the rod
                        [-rodW * 0.5, rodW * 0.5].forEach(ex => {
                            const finial = new THREE.Mesh(new THREE.SphereGeometry(rodR * 1.5, 8, 6), rodMat);
                            finial.position.set(ex, h / 2 + rodR, rodR);
                            imageGroup.add(finial);
                        });
                    } else if (item.frame.endsWith('.glb')) {
                        // Custom GLB frame: drop a .glb in the show folder and reference it as "frame".
                        // Name the mesh that should receive the image "Image" — the code will scale
                        // the whole GLB so that mesh fits the loaded image dimensions exactly.
                        plane.visible = false;
                        gltfLoader.load('shows/' + showTitle + '/' + item.frame, (gltf) => {
                            let imageMesh = null;
                            gltf.scene.traverse(child => {
                                if (child.isMesh) {
                                    child.castShadow = true;
                                    child.receiveShadow = true;
                                    if (child.name === 'Image' && !imageMesh) imageMesh = child;
                                }
                            });
                            // Fall back to the first mesh if none is named "Image"
                            if (!imageMesh) {
                                gltf.scene.traverse(child => {
                                    if (child.isMesh && !imageMesh) imageMesh = child;
                                });
                            }
                            if (imageMesh) {
                                imageMesh.material = material;
                                // Scale the whole GLB so the "Image" mesh spans w × h
                                const box = new THREE.Box3().setFromObject(imageMesh);
                                const meshSize = box.getSize(new THREE.Vector3());
                                const scaleX = meshSize.x > 0 ? w / meshSize.x : 1;
                                const scaleY = meshSize.y > 0 ? h / meshSize.y : 1;
                                gltf.scene.scale.setScalar(Math.min(scaleX, scaleY));
                            }
                            imageGroup.add(gltf.scene);
                            needsRender = true;
                        });
                    } else if (item.frame === 'whiteboard') {
                        // Flat white panel with padding on all sides; image sits flush on front face
                        material.roughness = 0.18;
                        material.metalness = 0.4;
                        material.needsUpdate = true;
                        const pad  = Math.max(w, h) * 0.04;  // padding on each side
                        const boxW = w + pad * 2;
                        const boxH = h + pad * 2;
                        const boxD = 100;
                        const scaleMax = Math.max(item.scale.x, item.scale.y);
                        const panelMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f6, roughness: 0.82, metalness: 0.4 });
                        const panel = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), panelMat);
                        panel.castShadow = true;
                        panel.receiveShadow = true;
                        panel.position.set(0, 0, -boxD / 2 - boxD * 0.05);
                        panel.castShadow = true;
                        panel.receiveShadow = true;
                        imageGroup.add(panel);
                    } else {
                        // Metal frame (aluminum or any future solid-frame type)
                        const frameColors = { aluminum: 0xbec2c8 };
                        const frameColor = frameColors[item.frame] !== undefined ? frameColors[item.frame] : 0xbec2c8;
                        const frameMat = new THREE.MeshStandardMaterial({ color: frameColor, metalness: 0.85, roughness: 0.25 });
                        const t = Math.max(w, h) * 0.02;
                        const d = t * 0.8;
                        const zo = 0.02;
                        [
                            { bw: w + t * 2, bh: t, bx: 0,              by:  h / 2 + t / 2 },
                            { bw: w + t * 2, bh: t, bx: 0,              by: -h / 2 - t / 2 },
                            { bw: t,         bh: h, bx: -w / 2 - t / 2, by: 0 },
                            { bw: t,         bh: h, bx:  w / 2 + t / 2, by: 0 },
                        ].forEach(({ bw, bh, bx, by }) => {
                            const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), frameMat);
                            bar.position.set(bx, by, zo);
                            bar.castShadow = true;
                            bar.receiveShadow = true;
                            imageGroup.add(bar);
                        });
                    }
                }

                needsRender = true;
            });

            positionOnWall(imageGroup, item);
            imageGroup.scale.set(item.scale.x, item.scale.y, item.scale.z);
            scene.add(imageGroup);
            addItemLight(imageGroup);
            console.log('Added image to scene:', item.src);
        }

        function addModelToScene(item, showTitle) {
            gltfLoader.load('shows/' + showTitle + '/' + item.src, (gltf) => {
                const model = gltf.scene;
                model.scale.set(item.scale.x, item.scale.y, item.scale.z);
                applyGLBMaterials(model, false);
                if (item.opacity !== undefined && item.opacity < 1) {
                    model.traverse(child => {
                        if (child.isMesh && child.material) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(m => { m.transparent = true; m.opacity = item.opacity; m.needsUpdate = true; });
                        }
                    });
                }
                positionOnWall(model, item);
                scene.add(model);
                addItemLight(model);
                console.log('Added model to scene:', item.src);
            }, undefined, error => {
                console.error('Error loading model:', error);
            });
        }

        function addVideoToScene(item, showTitle) {
            const video = document.createElement('video');
            video.src = 'shows/' + showTitle + '/' + item.src;
            video.crossOrigin = 'anonymous';
            video.loop = true;
            video.muted = false;  // Audio routed through Web Audio API
            video.playsInline = true;
            video.autoplay = true;

            // Resume AudioContext on first user interaction (browser autoplay policy)
            const resumeCtx = () => {
                if (audioListener.context.state === 'suspended') {
                    audioListener.context.resume();
                }
                video.play();
                document.removeEventListener('click', resumeCtx);
                document.removeEventListener('keydown', resumeCtx);
            };
            document.addEventListener('click', resumeCtx, { once: true });
            document.addEventListener('keydown', resumeCtx, { once: true });
            video.play().catch(() => {});  // Silent fail until user gesture

            const videoTex = new THREE.VideoTexture(video);
            videoTex.colorSpace = THREE.SRGBColorSpace;

            const w = item.width || 16;
            const h = item.height || 9;
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({
                    map: videoTex,
                    side: THREE.DoubleSide,
                    transparent: (item.opacity !== undefined && item.opacity < 1),
                    opacity: (item.opacity !== undefined) ? item.opacity : 1
                })
            );
            if (item.scale) {
                plane.scale.set(item.scale.x, item.scale.y, item.scale.z);
            }
            video.volume = (item.volume !== undefined) ? Math.min(1, Math.max(0, item.volume)) : 1;

            // Positional audio — attaches to the plane so volume falls off with distance
            const sound = new THREE.PositionalAudio(audioListener);
            // Low-pass filter — cutoff drops when walls are between listener and source
            const wallFilter = audioListener.context.createBiquadFilter();
            wallFilter.type = 'lowpass';
            wallFilter.frequency.value = 20000; // starts fully open
            wallFilter.Q.value = 0.5;
            sound.setFilter(wallFilter);
            sound._wallFilter = wallFilter;
            sound.setMediaElementSource(video);
            sound.setRefDistance(10);    // Full volume within 10 units
            sound.setRolloffFactor(2);   // How fast it fades beyond refDistance
            sound.setMaxDistance(80);    // Inaudible beyond 80 units
            sound._baseVolume = (item.volume !== undefined) ? Math.min(1, Math.max(0, item.volume)) : 1;
            sound.setVolume(currentMode === 'game' ? sound._baseVolume : 0);
            plane.add(sound);
            positionalAudios.push(sound);

            positionOnWall(plane, item);
            scene.add(plane);

            // Register vo first so the VFC closure can reference it.
            // _distant = true means the plane is beyond VIDEO_PAUSE_DISTANCE;
            // when distant the video keeps playing (audio stays in sync) but
            // we skip the GPU texture upload entirely.
            const vo = { video, texture: videoTex, plane, _distant: false };
            videoObjects.push(vo);

            // Use requestVideoFrameCallback when available: texture upload only
            // happens when the decoder produces a new frame AND the plane is close.
            // Three.js r160+ also skips its own auto-update when the API exists,
            // so distant videos incur zero GPU cost on the VFC path.
            if (typeof video.requestVideoFrameCallback === 'function') {
                const scheduleVFC = () => {
                    video.requestVideoFrameCallback(() => {
                        if (!video.paused && !video.ended) {
                            if (!vo._distant) {
                                videoTex.needsUpdate = true;
                                needsRender = true;
                            }
                            scheduleVFC();
                        }
                    });
                };
                video.addEventListener('play', scheduleVFC, { once: false });
            }
            // Fallback (no VFC): animate loop sets needsRender only when !_distant.

            console.log('Added video to scene:', item.src);
        }

        function addTvToScene(item, showTitle) {
            // ── Video element ─────────────────────────────────────────────────
            const video = document.createElement('video');
            video.src = 'shows/' + showTitle + '/' + item.src;
            video.crossOrigin = 'anonymous';
            video.loop = true;
            video.muted = false;
            video.playsInline = true;
            video.autoplay = true;

            const resumeCtx = () => {
                if (audioListener.context.state === 'suspended') audioListener.context.resume();
                video.play();
            };
            document.addEventListener('click', resumeCtx, { once: true });
            document.addEventListener('keydown', resumeCtx, { once: true });
            video.play().catch(() => {});

            const videoTex = new THREE.VideoTexture(video);
            videoTex.colorSpace = THREE.SRGBColorSpace;

            const vw = item.videoWidth  || 16;
            const vh = item.videoHeight || 9;
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(vw, vh),
                new THREE.MeshBasicMaterial({
                    map: videoTex,
                    side: THREE.DoubleSide,
                    transparent: (item.opacity !== undefined && item.opacity < 1),
                    opacity: (item.opacity !== undefined) ? item.opacity : 1
                })
            );

            video.volume = (item.volume !== undefined) ? Math.min(1, Math.max(0, item.volume)) : 1;

            // Positional audio
            const sound = new THREE.PositionalAudio(audioListener);
            const wallFilter = audioListener.context.createBiquadFilter();
            wallFilter.type = 'lowpass';
            wallFilter.frequency.value = 20000;
            wallFilter.Q.value = 0.5;
            sound.setFilter(wallFilter);
            sound._wallFilter = wallFilter;
            sound.setMediaElementSource(video);
            sound.setRefDistance(10);
            sound.setRolloffFactor(2);
            sound.setMaxDistance(80);
            sound._baseVolume = (item.volume !== undefined) ? Math.min(1, Math.max(0, item.volume)) : 1;
            sound.setVolume(currentMode === 'game' ? sound._baseVolume : 0);
            plane.add(sound);
            positionalAudios.push(sound);

            // Distance-aware texture update (shared with addVideoToScene optimisation)
            const vo = { video, texture: videoTex, plane, _distant: false };
            videoObjects.push(vo);
            if (typeof video.requestVideoFrameCallback === 'function') {
                const scheduleVFC = () => {
                    video.requestVideoFrameCallback(() => {
                        if (!video.paused && !video.ended) {
                            if (!vo._distant) { videoTex.needsUpdate = true; needsRender = true; }
                            scheduleVFC();
                        }
                    });
                };
                video.addEventListener('play', scheduleVFC, { once: false });
            }

            // ── TV GLB ────────────────────────────────────────────────────────
            // Always load the shared TV model; path is relative to the show folder.
            const tvGlb = item.type === 'tvalt' ? 'tvalt.glb' : 'tv.glb';
            gltfLoader.load('./building/' + tvGlb, (gltf) => {
                const model = gltf.scene;
                model.scale.set(item.scale.x, item.scale.y, item.scale.z);
                applyGLBMaterials(model, false);
                positionOnWall(model, item);
                scene.add(model);

                // Derive the video plane world position: project the TV model's
                // AABB onto its screen normal to find the front-face centre.
                // positionOnWall orients the model so local +Z faces the gallery
                // interior (the screen side).
                model.updateMatrixWorld(true);
                const bbox        = new THREE.Box3().setFromObject(model);
                const bboxCenter  = bbox.getCenter(new THREE.Vector3());
                const halfExtents = bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
                const screenNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion);
                // Support for any wall orientation: project AABB half-extents onto normal.
                const absN = new THREE.Vector3(
                    Math.abs(screenNormal.x),
                    Math.abs(screenNormal.y),
                    Math.abs(screenNormal.z)
                );
                const halfDepth = halfExtents.dot(absN);
                // Sit the video plane flush on the screen face with a tiny epsilon.
                plane.position.copy(bboxCenter).addScaledVector(screenNormal, halfDepth + 0.05);
                plane.quaternion.copy(model.quaternion);

                // Apply optional per-item videoOffset (world-space x/y/z nudge)
                // and videoRotation (x/y/z degrees added on top of the TV rotation).
                // Use these in meta.json to correct the screen alignment for any TV.
                const DEG2RAD = Math.PI / 180;
                if (item.videoOffset) {
                    plane.position.x += item.videoOffset.x || 0;
                    plane.position.y += item.videoOffset.y || 0;
                    plane.position.z += item.videoOffset.z || 0;
                }
                if (item.videoRotation) {
                    plane.rotation.x += (item.videoRotation.x || 0) * DEG2RAD;
                    plane.rotation.y += (item.videoRotation.y || 0) * DEG2RAD;
                    plane.rotation.z += (item.videoRotation.z || 0) * DEG2RAD;
                }

                const vs = item.videoScale || 1;
                plane.scale.setScalar(vs);

                scene.add(plane);
                console.log('Added TV to scene:', item.src);
            }, undefined, err => console.error('TV model load error:', err));
        }

        function loadShow() {
            var hash = window.location.hash.replace('#', '');
            if (hash.length == 0) {
                return;
            }
            var showTitle = decodeURIComponent(hash);
            console.log('Loading show: ' + showTitle);
            
            fetch('shows/' + showTitle + '/meta.json')
                .then(response => response.json())
                .then(meta => {
                    console.log('Show meta:', meta);
                    if (!meta || !meta.media) {
                        throw new Error('Invalid meta.json format');
                    }
                    
                    meta.media.forEach(item => {
                        console.log('Adding item to scene:', item);
                        if (item.type === 'image') {
                            addImageToScene(item, showTitle);
                        } else if (item.type === 'model') {
                            addModelToScene(item, showTitle);
                        } else if (item.type === 'video') {
                            addVideoToScene(item, showTitle);
                        } else if (item.type === 'tv' || item.type === 'tvalt') {
                            addTvToScene(item, showTitle);
                        }
                    });

                    // Load furniture models and pedestals declared in meta.json
                    if (Array.isArray(meta.furniture)) {
                        meta.furniture.forEach(item => {
                            if (item.model) loadFurnitureModel(item, showTitle);
                            else if (item.type === 'pedestal') {
                                const DEG2RAD = Math.PI / 180;
                                const p = item.position || {};
                                const s = item.size || {};
                                const rotY = ((item.rotation && item.rotation.y) || 0) * DEG2RAD;
                                makePedestal(
                                    p.x ?? 0, p.y ?? 0, p.z ?? 0,
                                    s.w ?? 5,  s.h ?? 9,  s.d ?? 5,
                                    rotY || undefined
                                );
                                // Optional book on top: 1 = book1, 2 = book2, 0/none = no book
                                const bookNum = item.book;
                                if (bookNum && bookNum !== 'none' && bookNum !== 0) {
                                    const bookKey = 'book' + bookNum;
                                    const bookDefaults = {
                                        book1: { scale: { x: 6, y: 6, z: 6 }, rotation: { x: 0, y: 2.87, z: 0 } },
                                        book2: { scale: { x: 7, y: 7, z: 7 }, rotation: { x: 0, y: 270, z: 0 } }
                                    };
                                    const bd = bookDefaults[bookKey] || { scale: { x: 6, y: 6, z: 6 }, rotation: { x: 0, y: 0, z: 0 } };
                                    loadFurnitureModel({
                                        model: bookKey,
                                        position: { x: p.x ?? 0, y: (p.y ?? 0) + (s.h ?? 9) + 0.4, z: p.z ?? 0 },
                                        rotation: bd.rotation,
                                        scale: bd.scale,
                                        collider: false
                                    }, showTitle);
                                }
                            }
                        });
                    }
                })
                .catch(error => {
                    console.error('Error loading show meta:', error);
                });
        }
