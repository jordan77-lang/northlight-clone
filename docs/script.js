        import * as THREE from 'three';
        import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
        import { DRACOLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';
        import { EXRLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/EXRLoader.js';
        import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';
        import { RoomEnvironment } from 'https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js';

        // Scene setup
        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0xb0c4de, 150, 600);  // Atmospheric fog for depth
        // Camera
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1.0, 700); // larger near plane improves depth precision; far 700 keeps full gallery range
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
        renderer.toneMappingExposure = 1.12;  // Slightly brighter overall gallery exposure
        renderer.outputColorSpace = THREE.SRGBColorSpace;  // Proper color accuracy
        renderer.dithering = true;  // Eliminate banding in fog/sky gradients — zero cost
        renderer.localClippingEnabled = true;  // Enable local clipping for Y-axis cropping

        // Environment lighting:
        // 1) start with a lightweight RoomEnvironment fallback so the scene always has IBL,
        // 2) then try to replace it with an EXR HDRI if present.
        const fallbackPmrem = new THREE.PMREMGenerator(renderer);
        const fallbackEnvRT = fallbackPmrem.fromScene(new RoomEnvironment(), 0.04);
        scene.environment = fallbackEnvRT.texture;
        fallbackPmrem.dispose();

        const HDRI_EXR_PATH = './building/HDRI/christmas_photo_studio_02_2k.exr';
        const exrLoader = new EXRLoader();
        // Defer HDRI so the building GLB and JPG textures get network priority first.
        setTimeout(() => {
            exrLoader.load(
                HDRI_EXR_PATH,
                (exrTexture) => {
                    exrTexture.mapping = THREE.EquirectangularReflectionMapping;
                    const hdriPmrem = new THREE.PMREMGenerator(renderer);
                    const hdriEnvRT = hdriPmrem.fromEquirectangular(exrTexture);
                    scene.environment = hdriEnvRT.texture;
                    exrTexture.dispose();
                    hdriPmrem.dispose();
                    fallbackEnvRT.dispose();
                    needsRender = true;
                },
                undefined,
                (error) => {
                    console.warn('EXR HDRI not loaded; using RoomEnvironment fallback:', HDRI_EXR_PATH, error);
                }
            );
        }, 200);
        renderer.xr.enabled = true;
        document.body.appendChild(renderer.domElement);

        // VR button — only shown when in game mode
        const vrButtonInner = VRButton.createButton(renderer);
        const vrButton = document.createElement('div');
        vrButton.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999;display:none;';
        vrButton.appendChild(vrButtonInner);
        document.body.appendChild(vrButton);

        // If WebXR immersive-vr is not available, swap the VR button for a
        // QR code button so the user can transfer the page to an XR-capable device.
        function installQRFallback() {
            vrButtonInner.remove();
            const qrBtn = document.createElement('button');
            qrBtn.textContent = '\uD83D\uDCF1 Open on XR device';
            qrBtn.style.cssText = [
                'padding:12px 20px',
                'background:rgba(0,0,0,0.75)',
                'color:#fff',
                'border:2px solid #888',
                'border-radius:6px',
                'font-size:13px',
                'cursor:pointer',
                'white-space:nowrap'
            ].join(';');
            qrBtn.addEventListener('click', () => {
                const url = window.location.href;
                document.getElementById('qrImg').src =
                    'https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' +
                    encodeURIComponent(url);
                document.getElementById('qrUrl').textContent = url;
                document.getElementById('qrModal').style.display = 'flex';
            });
            vrButton.appendChild(qrBtn);
        }

        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-vr')
                .then(supported => { if (!supported) installQRFallback(); })
                .catch(() => installQRFallback());
        } else {
            installQRFallback();
        }

        // Keep camera rig at correct eye height in VR
        renderer.xr.addEventListener('sessionstart', () => {
            needsRender = true;
            // No pointer lock needed in XR — update the instruction text
            if (currentMode === 'game') {
                document.getElementById('controlsInfo').innerHTML =
                    '<p><strong>Game Mode Controls:</strong></p>' +
                    '<p>WASD / Arrow Keys — Move</p>' +
                    '<p>Head movement — Look</p>';
            }
        });
        renderer.xr.addEventListener('sessionend', () => {
            needsRender = true;
            // Restore desktop instructions when XR ends
            if (currentMode === 'game') {
                document.getElementById('controlsInfo').innerHTML =
                    '<p><strong>Game Mode Controls:</strong></p>' +
                    '<p>WASD / Arrow Keys - Move</p>' +
                    '<p>Mouse - Look around</p>' +
                    '<p style="color:red;background:white;padding:2px 5px;text-transform:uppercase;">Click anywhere to enable navigation</p>' +
                    '<p>(press ESC to release mouse lock)</p>';
                isLocked = false;
                pointerLockReady = false;
                pointerLockExitAt = performance.now();
            }
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
        const isChromeBrowser = (() => {
            const ua = navigator.userAgent || '';
            return /Chrome\/\d+/i.test(ua) && !/Edg\//i.test(ua) && !/OPR\//i.test(ua);
        })();
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
        const showSelect = document.getElementById('showSelect');
        const BLANK_GALLERY_VALUE = '__blank__';

        function buildShowAssetPath(showTitle, assetPath = '') {
            const encodedShow = encodeURIComponent(String(showTitle || '').trim());
            const encodedAsset = String(assetPath || '')
                .split('/')
                .filter(Boolean)
                .map(segment => encodeURIComponent(segment))
                .join('/');
            return encodedAsset ? `shows/${encodedShow}/${encodedAsset}` : `shows/${encodedShow}`;
        }

        async function discoverShows() {
            const discovered = new Set();

            const addShowName = (name) => {
                if (!name) return;
                const cleaned = String(name).trim().replace(/^\/+|\/+$/g, '');
                if (!cleaned || cleaned.includes('/') || cleaned.startsWith('.')) return;
                discovered.add(cleaned);
            };

            // Preferred source for production: explicit manifest file.
            try {
                const res = await fetch('shows/index.json', { cache: 'no-store' });
                if (res.ok) {
                    const list = await res.json();
                    if (Array.isArray(list)) {
                        list.forEach(addShowName);
                    }
                }
            } catch (_) {
                // Fall back to directory listing parsing below.
            }

            // Dev fallback (e.g. Five Server): parse links from directory listing.
            if (discovered.size === 0) {
                try {
                    const res = await fetch('shows/', { cache: 'no-store' });
                    if (res.ok) {
                        const html = await res.text();
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        doc.querySelectorAll('a[href]').forEach((a) => {
                            const raw = a.getAttribute('href') || '';
                            const href = raw.split('#')[0].split('?')[0];
                            if (!href || href === '../' || href === './') return;

                            // Five Server may emit absolute paths; resolve + keep only the leaf folder.
                            const resolved = new URL(href, window.location.href);
                            const segments = decodeURIComponent(resolved.pathname)
                                .split('/')
                                .filter(Boolean);
                            const name = segments[segments.length - 1] || '';
                            addShowName(name);
                        });
                    }
                } catch (_) {
                    // No directory listing available.
                }
            }

            // Keep only folders that actually contain meta.json.
            const verified = (await Promise.all(
                [...discovered].map(async (name) => {
                    try {
                        const res = await fetch(`shows/${encodeURIComponent(name)}/meta.json`, { cache: 'no-store' });
                        return res.ok ? name : null;
                    } catch (_) {
                        return null;
                    }
                })
            )).filter(Boolean);

            const preferredShowOrder = ['unsuspected', 'Rolling Richard'];
            const preferredRank = (name) => {
                const index = preferredShowOrder.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase());
                return index === -1 ? Number.POSITIVE_INFINITY : index;
            };
            verified.sort((a, b) => {
                const rankA = preferredRank(a);
                const rankB = preferredRank(b);
                if (rankA !== rankB) return rankA - rankB;
                if (rankA !== Number.POSITIVE_INFINITY) return 0;
                return a.localeCompare(b);
            });
            return verified;
        }

        function syncShowSelectWithHash() {
            if (!showSelect) return;
            const current = decodeURIComponent(window.location.hash.replace('#', ''));
            showSelect.value = current || '';
        }

        async function setupShowSelector() {
            if (!showSelect) return;

            showSelect.innerHTML = '<option value="">Loading shows...</option>';
            const shows = await discoverShows();

            showSelect.disabled = false;
            showSelect.innerHTML = '<option value="__blank__">Blank gallery</option>';
            for (const show of shows) {
                const option = document.createElement('option');
                option.value = show;
                option.textContent = show;
                showSelect.appendChild(option);
            }

            const currentHash = decodeURIComponent(window.location.hash.replace('#', ''));
            if (currentHash === BLANK_GALLERY_VALUE || (currentHash && shows.includes(currentHash))) {
                showSelect.value = currentHash;
            } else if (shows.length > 0) {
                // Default to first available show so first-time visitors see content.
                const firstShow = shows[0];
                showSelect.value = firstShow;
                window.location.hash = encodeURIComponent(firstShow);
                if (modelScene) loadShow();
            } else {
                // No shows available: keep the selector usable with blank gallery selected.
                showSelect.value = BLANK_GALLERY_VALUE;
                window.location.hash = encodeURIComponent(BLANK_GALLERY_VALUE);
            }

            showSelect.addEventListener('change', () => {
                const selected = showSelect.value;
                const current = decodeURIComponent(window.location.hash.replace('#', ''));

                if (!selected) {
                    if (!current) return;
                    window.location.hash = '';
                    window.location.reload();
                    return;
                }

                if (selected === current) return;

                // Existing load path appends media; reload ensures a clean scene when switching.
                window.location.hash = encodeURIComponent(selected);
                window.location.reload();
            });

            window.addEventListener('hashchange', syncShowSelectWithHash);
        }

        setupShowSelector();
        
        let pointerLockReady = false;
        let pointerLockExitAt = 0;

        function requestGamePointerLock() {
            if (renderer.xr.isPresenting) return;
            if (document.pointerLockElement) return;
            if (performance.now() - pointerLockExitAt < 600) return;

            const lockRequest = document.body.requestPointerLock();
            if (lockRequest && typeof lockRequest.catch === 'function') {
                lockRequest.catch((err) => {
                    // Browsers reject immediate re-lock after ESC; ignore that case.
                    if (err?.name !== 'SecurityError') {
                        console.warn('Pointer lock failed:', err);
                    }
                });
            }
        }

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
                // Game mode is entered via a user gesture; resume audio and unmute video sources.
                if (audioListener?.context?.state === 'suspended') {
                    audioListener.context.resume().catch(() => {});
                }
                for (const vo of videoObjects) {
                    vo.video.muted = false;
                    vo.video.play().catch(() => {});
                }

                pointerLockReady = false; // require one extra click inside the canvas
                gameModeBtn.classList.add('active');
                exploreModeBtn.classList.remove('active');
                controlsInfo.innerHTML = isMobile
                    ? `<p><strong>Game Mode Controls:</strong></p>
                       <p>Left joystick — Move</p>
                       <p>Drag right side — Look</p>`
                    : `<p><strong>Game Mode Controls:</strong></p>
                       <p>WASD / Arrow Keys - Move</p>
                       <p>Mouse - Look around</p>
                       <p style="color: red; background:white; padding:2px 5px;text-transform: uppercase;">Click anywhere to enable navigation</p>
                       <p>(press ESC to release mouse lock)</p>`;

                if (isMobile) {
                    document.getElementById('touchJoystick').style.display = 'block';
                    document.getElementById('touchLook').style.display = 'block';
                    isLocked = true; // touch doesn't use pointer lock but movement always active
                } else {
                    isLocked = false;
                }
                camera.position.set(-4, 5.2, 20);
                yaw = 0; // Face inward (toward the gallery)
                pitch = 0;
                const spawnEuler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
                camera.quaternion.setFromEuler(spawnEuler);
                buildWalkDebug();
                walkDebugGroup.visible = debugMode;
                ensureFlatRoof();
                if (roofGroup) roofGroup.visible = true;
                vrButton.style.display = '';
                needsRender = true;
            } else {
                gameModeBtn.classList.remove('active');
                exploreModeBtn.classList.add('active');
                document.getElementById('touchJoystick').style.display = 'none';
                document.getElementById('touchLook').style.display = 'none';
                if (isMobile) isLocked = false;
                
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

        const layoutGuideCheckbox = document.getElementById('layoutGuideCheckbox');
        const layoutGuideHud = document.getElementById('layoutGuideHud');
        layoutGuideCheckbox.addEventListener('change', (event) => {
            layoutGuideEnabled = event.target.checked;
            wallGuideGroup.visible = layoutGuideEnabled;
            layoutGuideHud.style.display = layoutGuideEnabled ? 'block' : 'none';
            if (layoutGuideEnabled) {
                layoutGuideHud.innerHTML = '<strong>Layout Guide</strong><br>Point at a wall grid to read coordinates.';
            } else {
                layoutGuideHud.textContent = '';
            }
            buildWallPlacementGuides();
            needsRender = true;
        });
        
        // Explore mode camera state
        let exploreCameraDistance = 70;
        let exploreCameraPan = new THREE.Vector2(0, 0);
        let exploreCameraPanY = 0;
        let exploreRotation = new THREE.Vector2(0.5, 0.5);
        let lastExploreMousePos = new THREE.Vector2(0, 0);

        // Load the Northlight 3D model
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');

        const gltfLoader = new GLTFLoader();
        gltfLoader.setDRACOLoader(dracoLoader);

        const buildingTextureManager = new THREE.LoadingManager();
        const textureLoader = new THREE.TextureLoader(buildingTextureManager);

        let pendingNorthlightGltf = null;
        let buildingTexturesReady = false;
        let buildingVisualsReady = false;
        let exteriorFacadesAdded = false;

        function textureHasImage(texture) {
            const image = texture?.image;
            return !!(image && (image.width || image.data?.width));
        }

        function cloneLoadedTexture(texture) {
            if (!textureHasImage(texture)) return texture;
            return texture.clone();
        }

        function tryInitBuilding() {
            if (buildingVisualsReady || !buildingTexturesReady || !pendingNorthlightGltf) return;
            buildingVisualsReady = true;

            const model = pendingNorthlightGltf.scene;
            modelScene = model;

            setupModelTransform(model);
            createAndApplyClippingPlane(model);
            processModelMeshes(model);
            finalizeModelLoading(model);
        }

        function loadNorthlightModel() {
            gltfLoader.load('./building/Northlight.glb', (gltf) => {
                pendingNorthlightGltf = gltf;
                tryInitBuilding();
            }, undefined, (error) => {
                console.error('Error loading Northlight model:', error);
                isBuildingReady = true;
                document.getElementById('loading').style.display = 'none';
                loadShow();
            });
        }

        buildingTextureManager.onLoad = () => {
            buildingTexturesReady = true;
            initExteriorFacades();
            tryInitBuilding();
            needsRender = true;
        };
        
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
        let isBuildingReady = false;
        let currentLoadedShow = null;
        let showLoadInProgress = false;

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

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                if (materialFn) materialFn(model);

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
                glbPath = buildShowAssetPath(showTitle, item.src);
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
                liftObjectAboveFloor(clone, item);
                scene.add(clone);
                if (item.collider !== false) addObjectCollider(clone);
                if (key === 'table' && item.food === true) addTableFoodToScene(clone);
                needsRender = true;
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
                }
                
                // Detect wall colliders
                if (size.y > 5 && (size.x > 1 || size.z > 1)) {
                    wallColliders.push(bbox.clone());
                }

                // Force the exported floor mesh to use the concrete set.
                if (child.name === 'Floor0') {
                    if (!interiorConcreteOverlay) {
                        // Slight inset prevents floor overlay from poking through wall planes.
                        const overlayInset = 2.2;

                        const overlayMaterial = concreteFloorMaterial.clone();
                        overlayMaterial.side = THREE.FrontSide;

                        // Clone every texture so the interior floor can have its own
                        // repeat independent of the exterior ground plane.
                        // Keep detail density high without forcing obvious short-repeat tiling.
                        const tileSize = 14;
                        const oW = Math.max(1, size.x - overlayInset);
                        const oH = Math.max(1, size.z - overlayInset);
                        const oRepX = Math.max(1, oW / tileSize);
                        const oRepY = Math.max(1, oH / tileSize);
                        const overlayThickness = INTERIOR_FLOOR_THICKNESS;
                        const overlaySeed = 211;
                        const uvScale = 1.0 + seeded01(overlaySeed + 23) * 0.1;
                        const texRepeatX = Math.max(0.08, oRepX * uvScale);
                        const texRepeatY = Math.max(0.08, oRepY * uvScale);

                        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'].forEach((key) => {
                            if (!overlayMaterial[key]) return;
                            overlayMaterial[key] = overlayMaterial[key].clone();
                            overlayMaterial[key].wrapS = THREE.RepeatWrapping;
                            overlayMaterial[key].wrapT = THREE.RepeatWrapping;
                            overlayMaterial[key].repeat.set(texRepeatX, texRepeatY);
                            overlayMaterial[key].offset.set(seeded01(overlaySeed + 53), seeded01(overlaySeed + 67));
                            overlayMaterial[key].rotation = 0;
                            overlayMaterial[key].center.set(0.5, 0.5);
                            overlayMaterial[key].needsUpdate = true;
                        });

                        // Depth bias helps prevent coplanar flicker on some Chrome/GPU combos.
                        overlayMaterial.polygonOffset = true;
                        overlayMaterial.polygonOffsetFactor = -2;
                        overlayMaterial.polygonOffsetUnits = -2;

                        // Lower high-frequency normal/bump detail to reduce shimmer while moving.
                        if (overlayMaterial.normalScale) {
                            overlayMaterial.normalScale = new THREE.Vector2(0.075, 0.075);
                        }
                        overlayMaterial.bumpScale = 0.015;

                        if (isChromeBrowser) {
                            // Chrome/GPU combinations can shimmer with high-frequency normal/arm details.
                            // Keep diffuse stochastic detail, but use a stable matte response.
                            overlayMaterial.normalMap = null;
                            overlayMaterial.bumpMap = null;
                            overlayMaterial.roughnessMap = null;
                            overlayMaterial.metalnessMap = null;
                            overlayMaterial.aoMap = null;
                            overlayMaterial.roughness = 0.9;
                            overlayMaterial.metalness = 0.0;
                        }

                        applyInteriorConcreteStochastic(overlayMaterial, overlaySeed, { stable: isChromeBrowser });
                        overlayMaterial.needsUpdate = true;

                        interiorConcreteOverlay = createConcreteFloorSlab(oW, oH, overlayThickness, overlayMaterial);
                        interiorConcreteOverlay.position.set(
                            center.x,
                            center.y + 0.008 - (overlayThickness * 0.5),
                            center.z
                        );
                        interiorConcreteOverlay.receiveShadow = true;
                        interiorConcreteOverlay.castShadow = false;
                        interiorConcreteOverlay.renderOrder = 3;
                        scene.add(interiorConcreteOverlay);
                        pruneExteriorConcreteUnderInterior(interiorConcreteOverlay);
                    }

                    // Hide original GLB floor to avoid underside-only appearance artifacts.
                    child.visible = false;
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
            buildWallPlacementGuides();
            needsRender = true;
            // Building walls are now in the scene — safe to place show objects.
            isBuildingReady = true;
            document.getElementById('loading').style.display = 'none';
            loadShow();
        }
        
        loadNorthlightModel();

        // Exterior ground
        const concreteBaseColor = textureLoader.load('./building/Concrete_texture/worn_concrete_floor_diff_2k.jpg');
        const concreteAo = textureLoader.load('./building/Concrete_texture/worn_concrete_floor_ao_2k.jpg');
        const concreteArm = textureLoader.load('./building/Concrete_texture/worn_concrete_floor_arm_2k.jpg');
        const concreteHeight = textureLoader.load('./building/Concrete_texture/worn_concrete_floor_disp_2k.png');

        const groundWidth = 84.8;
        const groundLength = 186;
        const EXTERIOR_GROUND_TOP_Y = -1.95;
        const EXTERIOR_GROUND_THICKNESS = 0.24;
        const INTERIOR_FLOOR_THICKNESS = 0.2;

        function createConcreteFloorSlab(width, depth, thickness, topMaterial) {
            const slabGeometry = new THREE.BoxGeometry(width, thickness, depth);

            // r160+: aoMap uses 'uv1' (not 'uv2').
            slabGeometry.setAttribute(
                'uv1',
                new THREE.BufferAttribute(slabGeometry.attributes.uv.array, 2)
            );

            const sideMaterial = new THREE.MeshStandardMaterial({
                color: 0x8c8c8c,
                roughness: 0.92,
                metalness: 0.0
            });
            const bottomMaterial = new THREE.MeshStandardMaterial({
                color: 0x737373,
                roughness: 0.96,
                metalness: 0.0
            });

            // BoxGeometry face material order: right, left, top, bottom, front, back
            const slabMaterials = [
                sideMaterial.clone(),
                sideMaterial.clone(),
                topMaterial,
                bottomMaterial,
                sideMaterial.clone(),
                sideMaterial.clone()
            ];

            return new THREE.Mesh(slabGeometry, slabMaterials);
        }

        // Lower repeat values make each concrete tile appear larger.
        const repeatX = 0.30;
        const repeatY = 0.30 * (groundLength / groundWidth);

        [
            concreteBaseColor,
            concreteAo,
            concreteArm,
            concreteHeight
        ].forEach((texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(repeatX, repeatY);
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        });

        concreteBaseColor.colorSpace = THREE.SRGBColorSpace;
        concreteAo.colorSpace = THREE.NoColorSpace;
        concreteArm.colorSpace = THREE.NoColorSpace;
        concreteHeight.colorSpace = THREE.NoColorSpace;

        const concreteFloorMaterial = new THREE.MeshStandardMaterial({
            map: concreteBaseColor,
            aoMap: concreteAo,
            aoMapIntensity: 0.65,
            roughnessMap: concreteArm,
            metalnessMap: concreteArm,

            roughness: 0.82,

            bumpMap: concreteHeight,
            bumpScale: 0.028,

            color: 0xe6e6e6,
            metalness: 0.0,
            side: THREE.FrontSide
        });

        const exteriorGroundMaterial = new THREE.MeshStandardMaterial({
            color: 0x8f8f8f,
            roughness: 0.92,
            metalness: 0.0,
            side: THREE.FrontSide
        });

        setTimeout(() => {
            exrLoader.load(
                './building/Concrete_texture/worn_concrete_floor_nor_gl_2k.exr',
                (normalTex) => {
                    [normalTex].forEach((texture) => {
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        texture.repeat.set(repeatX, repeatY);
                        texture.magFilter = THREE.LinearFilter;
                        texture.minFilter = THREE.LinearMipmapLinearFilter;
                        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    });
                    normalTex.colorSpace = THREE.NoColorSpace;
                    concreteFloorMaterial.normalMap = normalTex;
                    concreteFloorMaterial.normalScale = new THREE.Vector2(0.11, 0.11);
                    concreteFloorMaterial.needsUpdate = true;
                    needsRender = true;
                },
                undefined,
                (error) => {
                    console.warn('Concrete normal EXR failed to load:', error);
                }
            );
        }, 300);

        function applyWallStochastic(material) {
            if (!material || !material.map) return;
            material.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    [
                        '#include <common>',
                        'vec2 wallHash2(vec2 p) {',
                        '    vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
                        '    return fract(sin(q) * 43758.5453123);',
                        '}',
                        // Stochastic tiling in tile space (0-1 per tile) so offsets are
                        // always a full tile fraction regardless of repeat count.
                        'vec4 wallTriStochastic(sampler2D tex, vec2 uv) {',
                        '    vec2 tileId = floor(uv);',       // which tile we are in
                        '    vec2 tileUv = fract(uv);',       // 0..1 within that tile
                        '    vec2 r0 = wallHash2(tileId);',
                        '    vec2 r1 = wallHash2(tileId + vec2(1.0, 0.0));',
                        '    vec2 r2 = wallHash2(tileId + vec2(0.0, 1.0));',
                        '    vec2 r3 = wallHash2(tileId + vec2(1.0, 1.0));',
                        // Bilinear blend weights based on position within tile
                        '    float wx = smoothstep(0.0, 1.0, tileUv.x);',
                        '    float wy = smoothstep(0.0, 1.0, tileUv.y);',
                        '    float w00 = (1.0-wx)*(1.0-wy);',
                        '    float w10 = wx*(1.0-wy);',
                        '    float w01 = (1.0-wx)*wy;',
                        '    float w11 = wx*wy;',
                        // Each corner samples from a random offset tile — offset by 0..1 tile widths
                        '    vec4 s0 = texture2D(tex, tileUv + floor(r0 * 4.0));',
                        '    vec4 s1 = texture2D(tex, tileUv + floor(r1 * 4.0));',
                        '    vec4 s2 = texture2D(tex, tileUv + floor(r2 * 4.0));',
                        '    vec4 s3 = texture2D(tex, tileUv + floor(r3 * 4.0));',
                        '    return s0*w00 + s1*w10 + s2*w01 + s3*w11;',
                        '}'
                    ].join('\n')
                );
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    [
                        '#ifdef USE_MAP',
                        '    vec4 sampledDiffuseColor = wallTriStochastic(map, vMapUv);',
                        '    #ifdef DECODE_VIDEO_TEXTURE',
                        '    sampledDiffuseColor = vec4(mix(pow(sampledDiffuseColor.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), sampledDiffuseColor.rgb * 0.0773993808, vec3(lessThanEqual(sampledDiffuseColor.rgb, vec3(0.04045)))), sampledDiffuseColor.w);',
                        '    #endif',
                        '    diffuseColor *= sampledDiffuseColor;',
                        '#endif'
                    ].join('\n')
                );
            };
            material.customProgramCacheKey = () => 'wall-stochastic-v2';
            material.needsUpdate = true;
        }

        function applyInteriorConcreteStochastic(material, seed = 0, options = {}) {
            if (!material || !material.map) return;
            const stableMix = !!options.stable;
            const primaryJitter = stableMix ? '0.72' : '0.96';
            const secondaryJitter = stableMix ? '0.44' : '0.58';
            const primaryScaleJitter = stableMix ? '0.07' : '0.11';
            const secondaryScaleJitter = stableMix ? '0.05' : '0.08';
            const macroBlend = stableMix ? '0.12' : '0.16';
            const blendFloor = stableMix ? '0.28' : '0.22';
            const blendGain = stableMix ? '0.26' : '0.34';

            material.userData.interiorConcreteSeed = seed;
            material.userData.interiorConcreteStableMix = stableMix;
            material.onBeforeCompile = (shader) => {
                const seeded = Number.isFinite(material.userData.interiorConcreteSeed)
                    ? material.userData.interiorConcreteSeed
                    : 0;

                shader.uniforms.interiorConcreteSeed = { value: seeded };

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    [
                        '#include <common>',
                        'uniform float interiorConcreteSeed;',
                        'float interiorHash(vec2 p) {',
                        '    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
                        '}',
                        'vec2 interiorHash2(vec2 p) {',
                        '    vec2 q = vec2(',
                        '        dot(p, vec2(127.1, 311.7)),',
                        '        dot(p, vec2(269.5, 183.3))',
                        '    );',
                        '    return fract(sin(q) * 43758.5453123);',
                        '}',
                        'float interiorNoise(vec2 p) {',
                        '    vec2 i = floor(p);',
                        '    vec2 f = fract(p);',
                        '    vec2 u = f * f * (3.0 - 2.0 * f);',
                        '    float a = interiorHash(i + vec2(0.0, 0.0));',
                        '    float b = interiorHash(i + vec2(1.0, 0.0));',
                        '    float c = interiorHash(i + vec2(0.0, 1.0));',
                        '    float d = interiorHash(i + vec2(1.0, 1.0));',
                        '    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
                        '}',
                        'mat2 interiorRot(float a) {',
                        '    float c = cos(a);',
                        '    float s = sin(a);',
                        '    return mat2(c, -s, s, c);',
                        '}',
                        'vec4 interiorSampleTriStochastic(sampler2D tex, vec2 uv, float seed, float jitterAmount, float scaleJitter) {',
                        '    const float K1 = 0.3660254037844386;',
                        '    const float K2 = 0.21132486540518713;',
                        '    vec2 p = uv * 1.75;',
                        '    vec2 i = floor(p + (p.x + p.y) * K1);',
                        '    vec2 a = p - i + (i.x + i.y) * K2;',
                        '    vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
                        '    vec2 b = a - o + K2;',
                        '    vec2 c = a - 1.0 + 2.0 * K2;',
                        '    vec3 w = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);',
                        '    w = w * w;',
                        '    w = w * w;',
                        '    vec3 wn = w / max(dot(w, vec3(1.0)), 1e-5);',
                        '    vec2 v0 = i;',
                        '    vec2 v1 = i + o;',
                        '    vec2 v2 = i + vec2(1.0);',
                        '    vec2 rnd0 = interiorHash2(v0 + vec2(seed, seed * 1.37));',
                        '    vec2 rnd1 = interiorHash2(v1 + vec2(seed, seed * 1.37));',
                        '    vec2 rnd2 = interiorHash2(v2 + vec2(seed, seed * 1.37));',
                        '    float ang0 = 6.28318530718 * rnd0.x;',
                        '    float ang1 = 6.28318530718 * rnd1.x;',
                        '    float ang2 = 6.28318530718 * rnd2.x;',
                        '    float scl0 = mix(1.0 - scaleJitter, 1.0 + scaleJitter, rnd0.y);',
                        '    float scl1 = mix(1.0 - scaleJitter, 1.0 + scaleJitter, rnd1.y);',
                        '    float scl2 = mix(1.0 - scaleJitter, 1.0 + scaleJitter, rnd2.y);',
                        '    vec2 off0 = (interiorHash2(v0 + vec2(19.7, 37.1) + seed) - 0.5) * jitterAmount;',
                        '    vec2 off1 = (interiorHash2(v1 + vec2(19.7, 37.1) + seed) - 0.5) * jitterAmount;',
                        '    vec2 off2 = (interiorHash2(v2 + vec2(19.7, 37.1) + seed) - 0.5) * jitterAmount;',
                        '    vec2 uv0 = interiorRot(ang0) * ((uv * scl0) - 0.5) + 0.5 + off0;',
                        '    vec2 uv1 = interiorRot(ang1) * ((uv * scl1) - 0.5) + 0.5 + off1;',
                        '    vec2 uv2 = interiorRot(ang2) * ((uv * scl2) - 0.5) + 0.5 + off2;',
                        '    vec4 s0 = texture2D(tex, uv0);',
                        '    vec4 s1 = texture2D(tex, uv1);',
                        '    vec4 s2 = texture2D(tex, uv2);',
                        '    return s0 * wn.x + s1 * wn.y + s2 * wn.z;',
                        '}'
                    ].join('\n')
                );

                const mapFragment = [
                    '#ifdef USE_MAP',
                    '    vec2 uv = vMapUv;',
                    `    vec4 cA = interiorSampleTriStochastic(map, uv, interiorConcreteSeed + 11.0, ${primaryJitter}, ${primaryScaleJitter});`,
                    `    vec4 cB = interiorSampleTriStochastic(map, uv * 1.37 + vec2(0.173, 0.287), interiorConcreteSeed + 29.0, ${secondaryJitter}, ${secondaryScaleJitter});`,
                    '    float blendNoise = interiorNoise(uv * 2.3 + vec2(interiorConcreteSeed * 0.017, interiorConcreteSeed * 0.023));',
                    `    float blendT = ${blendFloor} + ${blendGain} * smoothstep(0.22, 0.78, blendNoise);`,
                    '    vec4 sampledDiffuseColor = mix(cA, cB, clamp(blendT, 0.0, 1.0));',
                    '    vec2 macroUv = uv * 0.21 + vec2(interiorConcreteSeed * 0.013, interiorConcreteSeed * 0.017);',
                    '    vec4 macroColor = texture2D(map, macroUv);',
                    `    sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, macroColor.rgb, ${macroBlend});`,
                    '    diffuseColor *= sampledDiffuseColor;',
                    '#endif'
                ].join('\n');

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    mapFragment
                );
            };

            material.customProgramCacheKey = () => stableMix
                ? 'interior-concrete-stochastic-v2-stable'
                : 'interior-concrete-stochastic-v2';
            material.needsUpdate = true;
        }

        function seeded01(seed) {
            const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
            return x - Math.floor(x);
        }

        const exteriorConcretePatches = [];

        function pruneExteriorConcreteUnderInterior(interiorFloorMesh) {
            if (!interiorFloorMesh || exteriorConcretePatches.length === 0) return;

            interiorFloorMesh.updateWorldMatrix(true, false);
            const interiorBounds = new THREE.Box3().setFromObject(interiorFloorMesh);
            interiorBounds.expandByScalar(0.2);

            for (let i = exteriorConcretePatches.length - 1; i >= 0; i--) {
                const patch = exteriorConcretePatches[i];
                if (!patch || !patch.parent) {
                    exteriorConcretePatches.splice(i, 1);
                    continue;
                }
                patch.updateWorldMatrix(true, false);
                const patchBounds = new THREE.Box3().setFromObject(patch);
                if (patchBounds.intersectsBox(interiorBounds)) {
                    patch.parent.remove(patch);
                    exteriorConcretePatches.splice(i, 1);
                }
            }
        }

        function buildConcreteGroundPatches() {
            // Fewer, larger patches to avoid the floor reading as a 5x repeated tile grid.
            const patchCols = 3;
            const patchRows = 6;
            const patchW = groundWidth / patchCols;
            const patchH = groundLength / patchRows;
            const patchOverlap = 0.0;
            const originX = -1;
            const originY = EXTERIOR_GROUND_TOP_Y;
            const originZ = -49.4;

            for (let row = 0; row < patchRows; row++) {
                for (let col = 0; col < patchCols; col++) {
                    const seed = row * 97 + col * 131 + 17;
                    const localX = -groundWidth * 0.5 + patchW * 0.5 + col * patchW;
                    const localZ = -groundLength * 0.5 + patchH * 0.5 + row * patchH;

                    const mat = exteriorGroundMaterial.clone();
                    mat.userData.concreteSeed = seeded01(seed + 101) * 100.0;
                    mat.color = exteriorGroundMaterial.color.clone();
                    mat.roughness = exteriorGroundMaterial.roughness;

                    const patch = createConcreteFloorSlab(
                        patchW + patchOverlap,
                        patchH + patchOverlap,
                        EXTERIOR_GROUND_THICKNESS,
                        mat
                    );
                    patch.position.set(
                        originX + localX,
                        originY - (EXTERIOR_GROUND_THICKNESS * 0.5),
                        originZ + localZ
                    );
                    patch.castShadow = true;
                    patch.receiveShadow = true;
                    patch.renderOrder = 1;
                    exteriorConcretePatches.push(patch);
                    scene.add(patch);
                }
            }
        }

        buildConcreteGroundPatches();

        concreteFloorMaterial.side = THREE.DoubleSide;
        let interiorConcreteOverlay = null;

        // Add sky blue box — fog:false + same color as skyMat so tone-mapping output matches
        const boxGeometry = new THREE.BoxGeometry(32.5, 2, 11);
        const boxMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.FrontSide });
        const box = new THREE.Mesh(boxGeometry, boxMat);
        box.position.set(-27.5, -2, 38.5);
        scene.add(box);

        // =====================================================
        // FLAT ROOF — wooden beams, visible only in game mode
        // =====================================================

        function ensureFlatRoof() {
            if (roofGroup) return;
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
            // Dark void above the beams (top-facing only; hidden from below)
            const darkMat = new THREE.MeshBasicMaterial({ color: 0x151210, side: THREE.FrontSide });
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
            deck.rotation.x = -Math.PI * 0.5;
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
            
            // Exterior roof cover — visible from above only
            const topMat = new THREE.MeshStandardMaterial({ color: 0x000000, side: THREE.FrontSide, transparent: true, opacity: 0.95, map: topMatTexture });
            const topPlane = new THREE.Mesh(new THREE.PlaneGeometry(W+10, D+10), topMat);
            topPlane.rotation.x = -Math.PI * 0.5;
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
        }

        // =====================================================
        // LIGHTING CONFIGURATION & SETUP
        // =====================================================
        
        let ambientLight, hemiLight, directionalLight, fillLight, frontFillLight, backFillLight;
        let gallerySpotLightsGroup = null;
        
        const lightingConfig = {
            ambient: { color: 0xffffff, intensity: 0.24 },
            hemisphere: { sky: 0xfff8f0, ground: 0x404040, intensity: 0.38 },
            directional: {
                color: 0xfff8f0,
                intensity: 0.78,
                position: [50, 80, 50],
                shadow: { mapSize: 2048, left: -60, right: 60, top: 60, bottom: -60 }
            },
            fill: { color: 0xf0f4ff, intensity: 0.75, position: [-50, 40, -50] },
            frontFill: { color: 0xffffff, intensity: 0.62, position: [0, 30, 100] },
            backFill: { color: 0xfff0e8, intensity: 0.58, position: [0, 20, -150] },
            spotlightDefaults: {
                color: 0xfff2dc,
                intensity: 3.2,
                distance: 65,
                angle: THREE.MathUtils.degToRad(21),
                penumbra: 0.5,
                decay: 2,
                shadowMapSize: 2048,
                shadowBias: -0.0002,
                shadowNormalBias: 0.02
            },
            gallerySpots: [
                { position: [-24, 27.2, 30], target: [-24, 10.2, 30], intensity: 3.2, castShadow: true },
                { position: [-8, 27.2, 31], target: [-8, 10.5, 31], intensity: 3.0 },
                { position: [8, 27.2, 31], target: [8, 10.5, 31], intensity: 3.0 },
                { position: [24, 27.2, 30], target: [24, 10.2, 30], intensity: 3.2, castShadow: true },
                { position: [-20, 27.2, -12], target: [-20, 11, -12], intensity: 2.9 },
                { position: [0, 27.2, -10], target: [0, 11.2, -10], intensity: 3.1, castShadow: true },
                { position: [20, 27.2, -12], target: [20, 11, -12], intensity: 2.9 },
                { position: [-13, 27.2, -52], target: [-13, 10.8, -52], intensity: 3.0 },
                { position: [13, 27.2, -52], target: [13, 10.8, -52], intensity: 3.0 },
                { position: [0, 27.2, -88], target: [0, 10.6, -88], intensity: 3.1, castShadow: true }
            ]
        };

        function setupMotivatedGallerySpots() {
            if (gallerySpotLightsGroup) {
                scene.remove(gallerySpotLightsGroup);
            }

            gallerySpotLightsGroup = new THREE.Group();
            gallerySpotLightsGroup.name = 'gallerySpotLights';

            const defaults = lightingConfig.spotlightDefaults;

            for (const spec of lightingConfig.gallerySpots) {
                const spot = new THREE.SpotLight(
                    spec.color ?? defaults.color,
                    spec.intensity ?? defaults.intensity,
                    spec.distance ?? defaults.distance,
                    spec.angle ?? defaults.angle,
                    spec.penumbra ?? defaults.penumbra,
                    defaults.decay
                );

                spot.position.set(...spec.position);
                spot.castShadow = !!spec.castShadow;

                if (spot.castShadow) {
                    spot.shadow.mapSize.set(defaults.shadowMapSize, defaults.shadowMapSize);
                    spot.shadow.bias = defaults.shadowBias;
                    spot.shadow.normalBias = defaults.shadowNormalBias;
                }

                const target = new THREE.Object3D();
                target.position.set(...spec.target);
                gallerySpotLightsGroup.add(target);
                spot.target = target;
                gallerySpotLightsGroup.add(spot);
            }

            scene.add(gallerySpotLightsGroup);
        }
        
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

            // Motivated track-style accent lighting for artwork and key wall zones.
            setupMotivatedGallerySpots();
        }
        
        setupLighting();
        
        // =====================================================
        // MODEL CLIPPING
        // =====================================================
        
        let modelClippingPlane = null;



        // Interior wall material (PBR texture set)
        const wallpaperMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.96,
            metalness: 0.0,
            emissive: 0x2a2a2a,
            emissiveIntensity: 0.12,
            side: THREE.DoubleSide
        });

        const wallBaseColor = textureLoader.load('./building/Wall_texture/Wall_Base_Color.jpg');
        const wallNormal = textureLoader.load('./building/Wall_texture/Wall_Normal.jpg');
        const wallRoughness = textureLoader.load('./building/Wall_texture/Wall_Roughness.jpg');
        const wallHeight = textureLoader.load('./building/Wall_texture/Wall_Height.jpg');

        [wallBaseColor, wallNormal, wallRoughness, wallHeight].forEach((texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4.8, 2.3);
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        });

        wallBaseColor.colorSpace = THREE.SRGBColorSpace;
        wallNormal.colorSpace = THREE.NoColorSpace;
        wallRoughness.colorSpace = THREE.NoColorSpace;
        wallHeight.colorSpace = THREE.NoColorSpace;

        wallpaperMaterial.map = wallBaseColor;
        wallpaperMaterial.normalMap = wallNormal;
        wallpaperMaterial.normalScale = new THREE.Vector2(0.005, 0.005);
        wallpaperMaterial.roughnessMap = null;
        wallpaperMaterial.bumpMap = wallHeight;
        wallpaperMaterial.bumpScale = 0.0008;
        wallpaperMaterial.envMapIntensity = 0.3;
        applyWallStochastic(wallpaperMaterial);

        const brickBaseColor = textureLoader.load('./building/Brick wall/factory_brick_diff_2k.jpg');
        const brickArm = textureLoader.load('./building/Brick wall/factory_brick_arm_2k.jpg');
        const brickHeight = textureLoader.load('./building/Brick wall/factory_brick_disp_2k.png');

        const configureBrickTexture = (texture) => {
            if (!texture) return;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(2.2, 3.4);
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        };

        [brickBaseColor, brickArm, brickHeight].forEach(configureBrickTexture);

        brickBaseColor.colorSpace = THREE.SRGBColorSpace;
        brickArm.colorSpace = THREE.NoColorSpace;
        brickHeight.colorSpace = THREE.NoColorSpace;

        const brickMaterial = new THREE.MeshStandardMaterial({
            map: brickBaseColor,
            roughnessMap: brickArm,
            roughness: 0.92,
            metalnessMap: brickArm,
            metalness: 0.0,
            bumpMap: brickHeight,
            bumpScale: 0.012,
            color: 0xffb3a4,
            vertexColors: false
        });
        
        const whiteMaterial = new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.96,
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
            map: brickBaseColor,
            roughnessMap: brickArm,
            metalnessMap: brickArm,
            bumpMap: brickHeight,
            bumpScale: 0.012,
            color: 0xffb3a4,
            roughness: 0.92,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        setTimeout(() => {
            exrLoader.load(
                './building/Brick wall/factory_brick_nor_gl_2k.exr',
                (normalTex) => {
                    configureBrickTexture(normalTex);
                    normalTex.colorSpace = THREE.NoColorSpace;
                    brickMaterial.normalMap = normalTex;
                    brickMaterial.normalScale = new THREE.Vector2(0.16, 0.16);
                    wall1Material.normalMap = normalTex;
                    wall1Material.normalScale = new THREE.Vector2(0.16, 0.16);
                    brickMaterial.needsUpdate = true;
                    wall1Material.needsUpdate = true;
                    needsRender = true;
                },
                undefined,
                (error) => {
                    console.warn('Factory brick normal EXR failed to load:', error);
                }
            );
        }, 400);

        const blackBaseboardMaterial = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.75,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        const noBaseboardWalls = new Set(['Wall2', 'Wall3', 'Wall4', 'Wall7', 'Wall8', 'Wall9', 'Wall11', 'Wall12', 'Wall13', 'Wall15', 'Wall16', 'Wall20', 'Wall21']);
        // Wall14 shares the long left facade baseboard strip; skip interior strip there to avoid double baseboard.
        const noInteriorBaseboardWalls = new Set([...noBaseboardWalls, 'Wall14']);

        // Subtle dark strip used to ground baseboard-less partition walls.
        const wallFootShadowMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.52,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        });

        function addDrywallGapShadow(planeMesh, planeW, planeH, outward, faceOffset = 0.026) {
            const revealH = 0.11;
            for (const sideSign of [-1, 1]) {
                const reveal = new THREE.Mesh(
                    new THREE.PlaneGeometry(planeW, revealH),
                    wallFootShadowMaterial
                );
                reveal.rotation.y = planeMesh.rotation.y;
                reveal.position.copy(planeMesh.position);
                reveal.position.y -= (planeH * 0.5) - (revealH * 0.5);
                reveal.position.y += 0.01;
                reveal.position.addScaledVector(outward, faceOffset * sideSign);
                scene.add(reveal);
            }
        }

        function addDrywallGapShadowForWallMesh(wallMesh) {
            if (!wallMesh || !noBaseboardWalls.has(wallMesh.name)) return;
            wallMesh.updateWorldMatrix(true, false);
            const bbox = new THREE.Box3().setFromObject(wallMesh);
            const size = bbox.getSize(new THREE.Vector3());
            const minAxis = size.x < size.z ? 'x' : 'z';
            const planeW = minAxis === 'x' ? size.z : size.x;
            const planeH = size.y;
            const thickness = minAxis === 'x' ? size.x : size.z;
            const faceOffset = (thickness * 0.5) + 0.03;
            const outward = new THREE.Vector3(Math.sin(wallMesh.rotation.y), 0, Math.cos(wallMesh.rotation.y));
            addDrywallGapShadow(wallMesh, planeW, planeH, outward, faceOffset);
        }
        
        const pedestalTexture = textureLoader.load('./building/pedestal.png');
        pedestalTexture.wrapS = THREE.RepeatWrapping;
        pedestalTexture.wrapT = THREE.RepeatWrapping;
        pedestalTexture.repeat.set(4, 9);
        pedestalTexture.magFilter = THREE.LinearFilter;
        pedestalTexture.minFilter = THREE.LinearMipmapLinearFilter;
        pedestalTexture.colorSpace = THREE.SRGBColorSpace;
        pedestalTexture.anisotropy = 16;
        
        // Procedural fabric normal map — generated on first fabric-frame use only.
        let fabricNormalTexture = null;
        function createFabricNormalMap() {
            const size = 512;
            const tw = 12;
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
            const canvas2 = document.createElement('canvas');
            canvas2.width = size; canvas2.height = size;
            const ctx2 = canvas2.getContext('2d');
            const img = ctx2.createImageData(size, size);
            const strength = 6.0;
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
        function getFabricNormalTexture() {
            if (!fabricNormalTexture) fabricNormalTexture = createFabricNormalMap();
            return fabricNormalTexture;
        }

        const pedestalMaterial = new THREE.MeshStandardMaterial({
            map: pedestalTexture,
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        
        const WALL_PLANE_FLOOR_Y = -1.79;
        const WALL_PLANE_CEIL_Y = 28.0;
        const WALL_PLANE_PARTITION_H = 26.29;
        const WALL_PLANE_FULL_H = WALL_PLANE_CEIL_Y - WALL_PLANE_FLOOR_Y;
        // Interior partition walls — capped at partition height.
        const WALL_PARTITION_WALLS = new Set([
            'Wall2', 'Wall7', 'Wall8', 'Wall9',
            'Wall12', 'Wall13', 'Wall20', 'Wall21'
        ]);
        const WALL_PRISM_ALIGNMENT = new Set(['Wall2', 'Wall10', 'Wall11', 'Wall12', 'Wall13']);
        const WALL_SEAM_CRITICAL = new Set(['Wall2', 'Wall12', 'Wall13', 'Wall14', 'Wall15', 'Wall16']);
        const buildingCenter = new THREE.Vector3();

        const PICK_SIDE_OVERRIDES = { Wall16: 1, Wall8: -1, Wall9: -1 };

        function pickInteriorWallSide(wallName, center, minAxis, material) {
            if (PICK_SIDE_OVERRIDES[wallName] !== undefined) return PICK_SIDE_OVERRIDES[wallName];
            if (material !== wallpaperMaterial) return 1;
            const toCenter = buildingCenter.clone().sub(center);
            return minAxis === 'x'
                ? (toCenter.x >= 0 ? 1 : -1)
                : (toCenter.z >= 0 ? 1 : -1);
        }

        function computeWallPlaneDimensions(wallName, rawPlaneW, rawPlaneH, isBrickMaterial) {
            const isPrismAlignmentWall = WALL_PRISM_ALIGNMENT.has(wallName);
            const isSeamCriticalWall = WALL_SEAM_CRITICAL.has(wallName);
            const isPartition = WALL_PARTITION_WALLS.has(wallName);
            const widthTrim = isPrismAlignmentWall ? 0.02 : (isSeamCriticalWall ? 0.22 : (isBrickMaterial ? 0.2 : 0.7));
            const heightTrim = isPartition ? 0 : (isSeamCriticalWall ? 0.06 : (isBrickMaterial ? 0.05 : 0));
            const planeW = Math.max(0.5, rawPlaneW - widthTrim);
            const heightCap = isPartition ? WALL_PLANE_PARTITION_H : WALL_PLANE_FULL_H;
            const planeH = isPartition
                ? Math.min(Math.max(0.5, rawPlaneH - heightTrim), heightCap)
                : heightCap;
            return { planeW, planeH };
        }

        function addWallPlanes(child, mat) {
            child.updateWorldMatrix(true, false);
            child.visible = false;  // Hide the actual wall

            const bbox = new THREE.Box3().setFromObject(child);
            const size = bbox.getSize(new THREE.Vector3());
            const center = bbox.getCenter(new THREE.Vector3());

            const minAxis = size.x < size.z ? 'x' : 'z';
            const rawPlaneW = minAxis === 'x' ? size.z : size.x;
            const rawPlaneH = size.y;
            const isBrickWallPlane = mat === wall1Material;
            const { planeW, planeH } = computeWallPlaneDimensions(child.name, rawPlaneW, rawPlaneH, isBrickWallPlane);
            const FLOOR_CLIP_Y = WALL_PLANE_FLOOR_Y;

            // Pick the face that points toward the gallery interior.
            const side = pickInteriorWallSide(child.name, center, minAxis, mat);
            const planeGeom = new THREE.PlaneGeometry(planeW, planeH);
            // Clone material and apply clipping plane if it exists
            const planeMat = mat.clone();
            if (modelClippingPlane) {
                planeMat.clippingPlanes = [...(planeMat.clippingPlanes || []), modelClippingPlane];
            }
            if (child.name === 'Wall16' && mat === wallpaperMaterial) {
                // These walls look cleaner with a single front face; backface shading can look smeared.
                planeMat.side = THREE.FrontSide;
            }
            if (child.name === 'Wall10' && mat === wallpaperMaterial) {
                // Wall10 has exterior facade coverage; render only inward face to avoid outside bleed-through.
                planeMat.side = THREE.FrontSide;
            }
            if (child.name === 'Wall11' && mat === wall1Material) {
                // Brick exterior should not be visible from interior/window opening side.
                planeMat.side = THREE.FrontSide;
            }
            planeMat.polygonOffset = true;
            planeMat.polygonOffsetFactor = -1;
            planeMat.polygonOffsetUnits = -1;

            // Scale texture repeat by physical wall size so each tile is the same
            // real-world size on every wall regardless of orientation or width.
            if (mat === wallpaperMaterial) {
                const texelsPerUnit = 4.8 / 30;
                const repeatX = Math.max(0.75, texelsPerUnit * planeW);
                const repeatY = Math.max(0.75, texelsPerUnit * planeH);
                // Rotate UV 90° on X-axis walls so the texture grain runs in the
                // same world direction as Z-axis walls. Also swap repeat values so
                // the wide repeat still runs along the wall width after rotation.
                const uvRotation = minAxis === 'x' ? Math.PI / 2 : 0;
                const rU = minAxis === 'x' ? repeatY : repeatX;
                const rV = minAxis === 'x' ? repeatX : repeatY;
                ['map', 'normalMap', 'roughnessMap', 'bumpMap'].forEach((key) => {
                    const texture = planeMat[key];
                    if (!texture) return;
                    planeMat[key] = cloneLoadedTexture(texture);
                    planeMat[key].repeat.set(rU, rV);
                    planeMat[key].offset.set(0, 0);
                    planeMat[key].center.set(0.5, 0.5);
                    planeMat[key].rotation = uvRotation;
                });
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

            if(child.name=="Wall2"){
                planeMesh.position.z += .53;
                planeMesh.position.x -= .05;
                planeMesh.rotation.y += 0.01;
                planeMesh.scale.set(1.02, 1, 1);
            }
            else if(child.name=="Wall8"){
                planeMesh.position.z -= .2;
            }
            else if(child.name=="Wall9"){
                planeMesh.scale.set(.8, 1, 1);
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
                    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap'].forEach((key) => {
                        if (!planeMat[key]) return;
                        planeMat[key] = cloneLoadedTexture(planeMat[key]);
                        planeMat[key].repeat.set(3 * scaleX, 4.5 * scaleY);
                    });
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

            // Anchor bottom of plane to the floor — with planeH capped at room height
            // the top lands exactly at the ceiling: no gap, no clip.
            planeMesh.position.y = FLOOR_CLIP_Y + planeH * 0.5;

            // All interior (wallpaper) walls get a baseboard along their base.
            // Brick/exterior walls intentionally excluded.
            // Wall16 has a door — no baseboard (would clip through the door rectangle).
            const isWallpaperWall = mat === wallpaperMaterial;
            const lacksBaseboard = isWallpaperWall && noInteriorBaseboardWalls.has(child.name);

            let outward = null;
            let boardSide = -1;
            let boardOffset = 0.06;
            if (isWallpaperWall) {
                outward = new THREE.Vector3(Math.sin(planeMesh.rotation.y), 0, Math.cos(planeMesh.rotation.y));
                // Wall10 and Wall0 face the opposite interior direction from the rest.
                boardSide = (child.name === 'Wall10' || child.name === 'Wall0') ? 1 : -1;
                boardOffset = (child.name === 'Wall10' || child.name === 'Wall0') ? 0.1 : 0.06;
            }

            if (mat === wallpaperMaterial && !noInteriorBaseboardWalls.has(child.name)) {
                const boardH = 0.88;
                const boardDepth = 0.16;
                const along = new THREE.Vector3(Math.cos(planeMesh.rotation.y), 0, -Math.sin(planeMesh.rotation.y));

                const addBaseboardSegment = (segmentLength, alongOffset = 0) => {
                    const board = new THREE.Mesh(
                        new THREE.BoxGeometry(segmentLength, boardH, boardDepth),
                        blackBaseboardMaterial
                    );
                    board.rotation.y = planeMesh.rotation.y;
                    board.position.copy(planeMesh.position);
                    board.position.y -= (planeH * 0.5) - (boardH * 0.5);
                    board.position.addScaledVector(outward, boardOffset * boardSide);
                    board.position.addScaledVector(along, alongOffset);
                    board.castShadow = true;
                    board.receiveShadow = true;
                    scene.add(board);
                };

                addBaseboardSegment(planeW, 0);
            }

            // For partition walls that intentionally have no baseboard, add a thin
            // dark foot strip so the wall-floor intersection doesn't look sterile.
            // Only partition-style baseboard-less walls get the dark floor reveal.
            if (lacksBaseboard && noBaseboardWalls.has(child.name)) {
                addDrywallGapShadow(planeMesh, planeW, planeH, outward);
            }

            // Wall14 sits close to the left facade interior skin; nudge slightly to avoid coplanar shimmer.
            if (child.name === 'Wall14') {
                const wall14Outward = new THREE.Vector3(Math.sin(planeMesh.rotation.y), 0, Math.cos(planeMesh.rotation.y));
                planeMesh.position.addScaledVector(wall14Outward, 0.02);
            }
            scene.add(planeMesh);
            const surfaceType = mat === wallpaperMaterial ? 'interior' : 'exterior';
            planeMesh.userData.placementSurface = surfaceType;
            planeMesh.userData.inwardSide = side;
            registerWallPlacementPlane(child.name, planeMesh, surfaceType);
        }

        // ─── Prism wall builder ────────────────────────────────────────────────
        // Walls 2, 12, 13, 15 are supposed to form a closed rectangular prism.
        // Processing them individually leads to gaps / overhangs at the corners
        // because each plane is sized and positioned relative to its own bbox.
        //
        // This function computes the UNION bounding box of all 4 source meshes
        // and places each plane exactly at the corresponding face of that box.
        // All four planes share the same extents, so their edges meet perfectly.
        function buildPrismWallPlanes(prismMeshes, mat) {
            const meshEntries = Object.entries(prismMeshes);
            if (meshEntries.length === 0) return;

            // Union bounding box
            const unionBox = new THREE.Box3();
            for (const [, mesh] of meshEntries) {
                mesh.updateWorldMatrix(true, false);
                unionBox.union(new THREE.Box3().setFromObject(mesh));
            }

            const prismCenter = unionBox.getCenter(new THREE.Vector3());
            const prismSize   = unionBox.getSize(new THREE.Vector3());
            const FLOOR_CLIP_Y = -1.79;

            for (const [wallName, mesh] of meshEntries) {
                mesh.visible = false;

                const bbox = new THREE.Box3().setFromObject(mesh);
                const mc   = bbox.getCenter(new THREE.Vector3());
                const ms   = bbox.getSize(new THREE.Vector3());

                // Determine which axis carries the wall's thickness.
                const minAxis = ms.x < ms.z ? 'x' : 'z';

                let planeW, planeH, posX, posY, posZ, rotY;
                planeH = prismSize.y;
                posY   = prismCenter.y;

                if (minAxis === 'x') {
                    planeW = prismSize.z;
                    posZ   = prismCenter.z;
                    // Closest face = which union face this mesh represents.
                    // Normal points OUTWARD from the prism (gallery is outside the box).
                    const distToMax = Math.abs(mc.x - unionBox.max.x);
                    const distToMin = Math.abs(mc.x - unionBox.min.x);
                    if (distToMax <= distToMin) {
                        posX = unionBox.max.x;
                        rotY = -Math.PI / 2;  // normal → +X (outward)
                    } else {
                        posX = unionBox.min.x;
                        rotY = Math.PI / 2;   // normal → −X (outward)
                    }
                } else {
                    planeW = prismSize.x;
                    posX   = prismCenter.x;
                    const distToMax = Math.abs(mc.z - unionBox.max.z);
                    const distToMin = Math.abs(mc.z - unionBox.min.z);
                    if (distToMax <= distToMin) {
                        posZ = unionBox.max.z;
                        rotY = 0;             // normal → +Z (outward)
                    } else {
                        posZ = unionBox.min.z;
                        rotY = Math.PI;       // normal → −Z (outward)
                    }
                }
                // Wall2 faces the opposite direction from Wall12/13 on this prism.
                if (wallName === 'Wall2') rotY += Math.PI;

                // Partition walls — always use the full partition height so the
                // side planes reach Y=24.5 and the top cap sits flush on them.
                planeH = 26.29;
                posY   = FLOOR_CLIP_Y + planeH * 0.5;

                const planeMat = mat.clone();
                if (modelClippingPlane) {
                    planeMat.clippingPlanes = [...(planeMat.clippingPlanes || []), modelClippingPlane];
                }
                planeMat.side = THREE.DoubleSide;
                planeMat.polygonOffset = true;
                planeMat.polygonOffsetFactor = -1;
                planeMat.polygonOffsetUnits = -1;

                const geom = new THREE.PlaneGeometry(planeW, planeH);
                const planeMesh = new THREE.Mesh(geom, planeMat);
                planeMesh.position.set(posX, posY, posZ);
                planeMesh.rotation.y = rotY;
                planeMesh.name = wallName + '_prismPlane';
                planeMesh.userData.placementSurface = 'interior';
                planeMesh.userData.prismInterior = true;
                // Derive inwardSide from the actual rotY so it always matches the plane normal.
                // rotY=+π/2 → normal=(−1,0,0) → inwardSide=−1 on x-axis
                // rotY=−π/2 → normal=(+1,0,0) → inwardSide=+1 on x-axis
                // rotY=π    → normal=(0,0,−1) → inwardSide=−1 on z-axis
                // rotY=0    → normal=(0,0,+1) → inwardSide=+1 on z-axis
                const faceN = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, rotY, 0));
                planeMesh.userData.inwardSide = minAxis === 'x'
                    ? (faceN.x >= 0 ? 1 : -1)
                    : (faceN.z >= 0 ? 1 : -1);
                scene.add(planeMesh);
                registerWallPlacementPlane(wallName, planeMesh, 'interior');

                if (mat === wallpaperMaterial && noBaseboardWalls.has(wallName)) {
                    const outward = new THREE.Vector3(Math.sin(planeMesh.rotation.y), 0, Math.cos(planeMesh.rotation.y));
                    addDrywallGapShadow(planeMesh, planeW, planeH, outward);
                }
            }

            // Re-add the prism top so Walls 2/12/13/15 are closed.
            const PARTITION_TOP_Y = FLOOR_CLIP_Y + 26.29; // 24.5
            const topCapMat = mat.clone();
            if (modelClippingPlane) {
                topCapMat.clippingPlanes = [...(topCapMat.clippingPlanes || []), modelClippingPlane];
            }
            topCapMat.side = THREE.DoubleSide;
            topCapMat.polygonOffset = true;
            topCapMat.polygonOffsetFactor = -1;
            topCapMat.polygonOffsetUnits = -1;
            const topCapGeom = new THREE.PlaneGeometry(prismSize.x, prismSize.z);
            const topCapMesh = new THREE.Mesh(topCapGeom, topCapMat);
            topCapMesh.rotation.x = -Math.PI / 2;
            topCapMesh.position.set(prismCenter.x, PARTITION_TOP_Y, prismCenter.z);
            topCapMesh.name = 'prism_topCap';
            scene.add(topCapMesh);

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
                ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap'].forEach((key) => {
                    if (!mat[key]) return;
                    mat[key] = cloneLoadedTexture(mat[key]);
                    mat[key].repeat.set(3 * scaleX, 4.5 * scaleY);
                });
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
                                map: textureHasImage(m.map) ? m.map : null,
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
                                map: textureHasImage(m.map) ? m.map : null,
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
        }

        // Convert all meshes in a GLB clone to MeshBasicMaterial preserving original map/color
        function applyGLBMaterials(object, flag) {
            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
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

        }

        function makePedestal(x, y, z, w, h, d, rotY) {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(w, h, d),
                pedestalMaterial
            );
            mesh.position.set(x, y + h / 2, z);
            if (rotY) mesh.rotation.y = rotY;
            liftObjectAboveFloor(mesh, { autoFloorClamp: true });
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
            clonedBackdoor.scale.set(25, 25, 25); // deeper Z so door frame covers baseboard ends
           // clonedBackdoor.rotation.y = 180 * (Math.PI / 180); // Rotate 180 degrees to face the correct direction
            
            applyGLBMaterials(clonedBackdoor);
            scene.add(clonedBackdoor);
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
                    }
                }
            });
        }

        function colorizeModel(model) {
            wallPlacementMeshes.clear();
            const modelBBox = new THREE.Box3().setFromObject(model);
            modelBBox.getCenter(buildingCenter);
            const modelHeight = Math.max(1e-3, modelBBox.max.y - modelBBox.min.y);
            const floorYThreshold = modelBBox.min.y + modelHeight * 0.4;
            const prismMeshes = {}; // Wall2/12/13/15 — built together after traversal

            model.traverse((child) => {
                if (child.isMesh) {
                    const name = child.name.toLowerCase();
                    const bbox = new THREE.Box3().setFromObject(child);
                    const center = bbox.getCenter(new THREE.Vector3());
                    const size = bbox.getSize(new THREE.Vector3());
                    const minPlanar = Math.min(size.x, size.z);
                    const isFlatAndLarge = size.x > 6 && size.z > 6 && size.y < (minPlanar * 0.35);
                    const isLowHorizontalSlab = center.y <= floorYThreshold && size.y < Math.max(1.5, minPlanar * 0.6);
                    const isHorizontalSlab = size.x > 1.5 && size.z > 1.5 && size.y < Math.max(1.2, minPlanar * 0.8);
                    const isLikelyFloorByName = name.includes('floor') || name.includes('ground') || name.includes('slab') || name.includes('pavement');
                    const isLikelyCeiling = name.includes('ceiling') || name.includes('roof') || name.includes('top');

                    // Floor0 is replaced by a concrete overlay in processModelMeshes; keep it hidden here.
                    if (child.name === 'Floor0') {
                        child.visible = false;
                        return;
                    }

                    // Ceiling/roof meshes are replaced by the procedural roof system.
                    // Keeping GLB ceiling slabs causes a floating horizontal plate.
                    if (isLikelyCeiling) {
                        child.visible = false;
                        return;
                    }

                    // Catch non-standard mesh names: any thin horizontal surface high in the
                    // building is treated as ceiling residue and hidden.
                    if ((isHorizontalSlab || isFlatAndLarge) && center.y > 20) {
                        child.visible = false;
                        return;
                    }

                    // GLB floor-like slabs overlap with the procedural interior/exterior floor
                    // system and can cause camera-dependent z-fighting shimmer.
                    // Keep only the procedural floor meshes.
                    if (!isLikelyCeiling && (isLikelyFloorByName || isFlatAndLarge || isLowHorizontalSlab || isHorizontalSlab)) {
                        child.visible = false;
                        return;
                    }

                    if (child.name === 'Opening0') {
                        child.material = skyBlueMaterial;
                        child.visible = true;
                        child.scale.set(1.2, 2.3, .14); // Slightly thicker so it reads as a doorway volume
                        // Preserve GLB orientation; forcing 90deg over-rotates this opening.
                        // Keep centered on the wall: no manual lateral offset.
                    } else if (child.name === 'Door0' || child.name === 'Door1') {
                        child.visible = false;
                    } else if (child.name === 'Window0') {
                        child.visible = false;
                    } else if (child.name === 'Wall3' || child.name === 'Wall4') {
                        child.visible = false;
                    } else if (child.name === 'Wall5') {
                        child.material = whiteMaterial;
                        child.visible = false;
                        addWallPlanes(child, wallpaperMaterial);
                    } else if (child.name === 'Wall7' || child.name === 'Wall8' || child.name === 'Wall9') {
                        child.material = whiteMaterial;
                        child.visible = false;
                        addWallPlanes(child, wallpaperMaterial);
                        if (child.name === 'Wall8' || child.name === 'Wall9') {
                            const _entry = wallPlacementMeshes.get(child.name);
                            if (_entry?.mesh) _entry.mesh.position.z = -89;
                        }
                    } else if (child.name === 'Wall11') {
                        child.material = whiteMaterial;
                        child.visible = false;
                        child.traverse(c => { if (c.isMesh) c.visible = false; });
                        addWallPlanes(child, wallpaperMaterial);
                    }
                    else if (child.name === 'Wall16') {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wallpaperMaterial);
                    } else if (name.includes('door')) {
                        child.material = yellowMaterial;
                    } else if (name.includes('window') || name.includes('glass')) {
                        child.material = greenMaterial;
                    } else if (child.name === 'Wall15') {
                        // Against exterior wall — no placement surface needed, hide GLB mesh
                        child.visible = false;
                        child.traverse(c => { if (c.isMesh) c.visible = false; });
                    } else if (['Wall2', 'Wall12', 'Wall13'].includes(child.name)) {
                        // Defer to buildPrismWallPlanes — processed together after traversal
                        child.material = whiteMaterial;
                        prismMeshes[child.name] = child;
                    } else if (child.name === 'Wall1' || child.name === 'Wall6') {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wall1Material);
                    } else {
                        child.material = whiteMaterial;
                        addWallPlanes(child, wallpaperMaterial);
                    }
                }
            });
            buildPrismWallPlanes(prismMeshes, wallpaperMaterial);

            // Remove any stray horizontal slab left above the prism partition walls.
            const prismEntries = Object.entries(prismMeshes);
            if (prismEntries.length > 0) {
                const prismUnion = new THREE.Box3();
                for (const [, mesh] of prismEntries) {
                    mesh.updateWorldMatrix(true, false);
                    prismUnion.union(new THREE.Box3().setFromObject(mesh));
                }

                const PARTITION_TOP_Y = -1.79 + 26.29; // 24.5
                model.traverse((child) => {
                    if (!child.isMesh) return;
                    if (['Wall2', 'Wall12', 'Wall13'].includes(child.name)) return;

                    const slabBox = new THREE.Box3().setFromObject(child);
                    const slabSize = slabBox.getSize(new THREE.Vector3());
                    const slabCenter = slabBox.getCenter(new THREE.Vector3());
                    const slabMinPlanar = Math.min(slabSize.x, slabSize.z);
                    const isHorizontalSlab =
                        slabSize.x > 1.5 && slabSize.z > 1.5 &&
                        slabSize.y < Math.max(1.2, slabMinPlanar * 0.8);

                    const overlapsPrismXZ =
                        slabBox.max.x > prismUnion.min.x && slabBox.min.x < prismUnion.max.x &&
                        slabBox.max.z > prismUnion.min.z && slabBox.min.z < prismUnion.max.z;

                    const abovePrismTop = slabCenter.y > PARTITION_TOP_Y + 0.05;
                    if (overlapsPrismXZ && abovePrismTop) {
                        child.visible = false;
                    }
                });
            }

            for (const w of manualWalls) {
                ensureManualWallPlacementPlane(w);
            }
        }

        // =====================================================
        // DEBUG MODE - Labels for walls, doors, windows
        // =====================================================
        
        let debugLabelsGroup = new THREE.Group();
        scene.add(debugLabelsGroup);
        let debugMode = false;
        let layoutGuideEnabled = false;
        const wallGuideGroup = new THREE.Group();
        wallGuideGroup.name = 'WallLayoutGuides';
        scene.add(wallGuideGroup);
        const LAYOUT_GUIDE_GRID_STEP = 5;
        const wallPlacementMeshes = new Map(); // wallName -> { mesh, area, centerDistance } interior display plane
        const WALL_FACE_DEFAULTS = {};
        const WALL_INWARD_SIGN_DEFAULTS = { Wall10: -1, Wall0: -1, Wall20: 1, Wall21: -1, Wall8: -1, Wall9: -1 };
        const GUIDE_SURFACE_OFFSET = 0.25;
        const DEFAULT_WALL_SURFACE_OFFSET = 0.16;
        const GUIDE_LINE_LOCAL_Z = 0.08;

        function registerWallPlacementPlane(wallName, planeMesh, surfaceType = 'interior') {
            planeMesh.userData.placementSurface = surfaceType;
            const planeW = planeMesh.geometry.parameters.width;
            const planeH = planeMesh.geometry.parameters.height;
            const planeArea = planeW * planeH;
            const centerDistance = planeMesh.position.distanceTo(buildingCenter);
            const existing = wallPlacementMeshes.get(wallName);
            if (!existing) {
                wallPlacementMeshes.set(wallName, { mesh: planeMesh, area: planeArea, centerDistance, surfaceType });
                return;
            }
            const existingType = existing.surfaceType || existing.mesh?.userData?.placementSurface;
            if (existingType === 'exterior' && surfaceType === 'interior') {
                wallPlacementMeshes.set(wallName, { mesh: planeMesh, area: planeArea, centerDistance, surfaceType });
                return;
            }
            if (existingType === 'interior' && surfaceType === 'exterior') {
                return;
            }
            if (
                centerDistance < existing.centerDistance - 1e-3 ||
                (Math.abs(centerDistance - existing.centerDistance) <= 1e-3 && planeArea > existing.area + 1e-3)
            ) {
                wallPlacementMeshes.set(wallName, { mesh: planeMesh, area: planeArea, centerDistance, surfaceType });
            }
        }

        function getInteriorPlacementMesh(wallName) {
            const entry = wallPlacementMeshes.get(wallName);
            if (!entry?.mesh) return null;
            const surfaceType = entry.surfaceType || entry.mesh.userData?.placementSurface;
            return surfaceType === 'interior' ? entry.mesh : null;
        }

        function computeDisplayPlaneFromWallMesh(wallName, wallMesh) {
            wallMesh.updateWorldMatrix(true, false);
            const bbox = new THREE.Box3().setFromObject(wallMesh);
            const center = bbox.getCenter(new THREE.Vector3());
            const size = bbox.getSize(new THREE.Vector3());
            const minAxis = size.x < size.z ? 'x' : 'z';
            const rawPlaneW = minAxis === 'x' ? size.z : size.x;
            const rawPlaneH = size.y;
            const { planeW, planeH } = computeWallPlaneDimensions(wallName, rawPlaneW, rawPlaneH, false);

            let side = pickInteriorWallSide(wallName, center, minAxis, wallpaperMaterial);

            const planeRot = new THREE.Euler(0, 0, 0);
            if (minAxis === 'x') {
                planeRot.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
            } else {
                planeRot.y = side === -1 ? Math.PI : 0;
            }

            const planePos = center.clone();
            if (minAxis === 'x') {
                planePos.x += side * (size.x / 2);
            } else {
                planePos.z += side * (size.z / 2);
            }
            // Keep center.y from bbox — matches original repo behaviour.

            return { planeW, planeH, planePos, planeRot, center, size, minAxis };
        }

        function ensureManualWallPlacementPlane(wallMesh) {
            const wallName = wallMesh.name;
            wallPlacementMeshes.delete(wallName);
            wallMesh.updateWorldMatrix(true, false);
            const bbox = new THREE.Box3().setFromObject(wallMesh);
            const center = bbox.getCenter(new THREE.Vector3());
            const size = bbox.getSize(new THREE.Vector3());
            const minAxis = size.x < size.z ? 'x' : 'z';
            const planeW = minAxis === 'x' ? size.z : size.x;
            const planeH = size.y;

            // Place the plane on the face that points toward the building interior.
            // Use the same autoSign logic as getWallPlacementFrame so the plane position
            // agrees with where positionOnWall expects the wall surface to be.
            // WALL_FACE_DEFAULTS only controls which direction art faces FROM the plane;
            // it does not move the plane to a different physical face of the box.
            const autoSign = minAxis === 'x'
                ? (center.x > 0 ? -1 : 1)
                : (center.z > 0 ? -1 : 1);
            const side = WALL_INWARD_SIGN_DEFAULTS[wallName] !== undefined
                ? WALL_INWARD_SIGN_DEFAULTS[wallName]
                : autoSign;

            const planeRot = new THREE.Euler(0, 0, 0);
            if (minAxis === 'x') {
                planeRot.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
            } else {
                planeRot.y = side === -1 ? Math.PI : 0;
            }

            const planePos = center.clone();
            if (minAxis === 'x') {
                planePos.x += side * (size.x / 2);
            } else {
                planePos.z += side * (size.z / 2);
            }
            // Keep center.y from bbox — matches original repo behaviour.

            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(planeW, planeH),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            plane.position.copy(planePos);
            plane.rotation.copy(planeRot);
            plane.name = wallName + '_placementPlane';
            plane.userData.inwardSide = side;
            registerWallPlacementPlane(wallName, plane, 'interior');
        }

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
        
        document.addEventListener('click', (event) => {
            if (currentMode !== 'game') return;
            if (event.target.closest('#modeSelector, #layoutGuideHud, #info, #qrModal, button, input, select, label, a')) {
                return;
            }
            if (!pointerLockReady) {
                pointerLockReady = true;
                return;
            }
            requestGamePointerLock();
        });

        let lockAcquiredAt = 0;

        document.addEventListener('pointerlockchange', () => {
            isLocked = !!document.pointerLockElement;
            if (isLocked) {
                lockAcquiredAt = performance.now();
                document.getElementById('info').style.opacity = '0.3';
            } else {
                pointerLockExitAt = performance.now();
                pointerLockReady = false;
                document.getElementById('info').style.opacity = '1';
            }
        });

        document.addEventListener('mousemove', (event) => {
            if (currentMode === 'game') {
                if (!isLocked && !renderer.xr.isPresenting) return;
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
            right: false,
            xrTap: false   // phone WebXR tap-to-walk
        };
        // Per-frame XR thumbstick state — reset each frame so releasing the
        // stick immediately stops movement. Kept separate from keyboard moveState.
        const xrStickState = { forward: false, backward: false, left: false, right: false, axisX: 0, axisY: 0 };

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

        // ── WebXR keyboard fallback ───────────────────────────────────────────
        // When a WebXR session is active (real headset + BT keyboard, or browser
        // emulator) the emulator extension / XR overlay may swallow keyboard
        // events in the bubbling phase before they reach the document listener
        // above.  Registering the same handlers on 'window' with capture:true
        // fires in the capture phase — before any element or extension handler
        // can call stopPropagation / stopImmediatePropagation.
        function _xrKey(down, event) {
            if (currentMode !== 'game') return;
            if (!renderer.xr.isPresenting) return; // desktop path uses document listener
            const v = down;
            switch (event.code) {
                case 'ArrowUp':    case 'KeyW': moveState.forward  = v; break;
                case 'ArrowDown':  case 'KeyS': moveState.backward = v; break;
                case 'ArrowLeft':  case 'KeyA': moveState.left     = v; break;
                case 'ArrowRight': case 'KeyD': moveState.right    = v; break;
            }
            if (v) needsRender = true;
        }
        window.addEventListener('keydown', (e) => _xrKey(true,  e), { capture: true });
        window.addEventListener('keyup',   (e) => _xrKey(false, e), { capture: true });
        // ─────────────────────────────────────────────────────────────────────

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
        // TOUCH JOYSTICK + LOOK (mobile game mode)
        // =====================================================

        (function setupTouchControls() {
            const joystickEl   = document.getElementById('touchJoystick');
            const knobEl       = document.getElementById('jKnob');
            const lookEl       = document.getElementById('touchLook');
            const JOYSTICK_R   = 60;    // radius in px — half the 120px base

            // ── Joystick ──────────────────────────────────────────────
            let jTouchId  = null;
            let jBaseX    = 0, jBaseY = 0;

            function joystickMove(cx, cy) {
                let dx = cx - jBaseX;
                let dy = cy - jBaseY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > JOYSTICK_R) {
                    dx *= JOYSTICK_R / dist;
                    dy *= JOYSTICK_R / dist;
                }
                // Move knob visually (offset from centre of base element)
                knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

                const nx = dx / JOYSTICK_R; // −1…1
                const ny = dy / JOYSTICK_R; // −1…1

                moveState.forward  = ny < -0.3;
                moveState.backward = ny >  0.3;
                moveState.left     = nx < -0.3;
                moveState.right    = nx >  0.3;
                needsRender = true;
            }

            function joystickRelease() {
                jTouchId = null;
                knobEl.style.transform = 'translate(-50%, -50%)';
                moveState.forward = moveState.backward = moveState.left = moveState.right = false;
            }

            joystickEl.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (currentMode !== 'game') return;
                const t = e.changedTouches[0];
                jTouchId = t.identifier;
                const rect = joystickEl.getBoundingClientRect();
                jBaseX = rect.left + rect.width  / 2;
                jBaseY = rect.top  + rect.height / 2;
                joystickMove(t.clientX, t.clientY);
            }, { passive: false });

            joystickEl.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (currentMode !== 'game') return;
                for (const t of e.changedTouches) {
                    if (t.identifier === jTouchId) {
                        joystickMove(t.clientX, t.clientY);
                    }
                }
            }, { passive: false });

            joystickEl.addEventListener('touchend',    (e) => { e.preventDefault(); joystickRelease(); }, { passive: false });
            joystickEl.addEventListener('touchcancel', (e) => { e.preventDefault(); joystickRelease(); }, { passive: false });

            // ── Look swipe ────────────────────────────────────────────
            let lTouchId  = null;
            let lLastX    = 0, lLastY = 0;

            lookEl.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (currentMode !== 'game') return;
                if (lTouchId !== null) return; // only one look touch at a time
                const t = e.changedTouches[0];
                lTouchId = t.identifier;
                lLastX   = t.clientX;
                lLastY   = t.clientY;
            }, { passive: false });

            lookEl.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (currentMode !== 'game') return;
                for (const t of e.changedTouches) {
                    if (t.identifier === lTouchId) {
                        const dx = t.clientX - lLastX;
                        const dy = t.clientY - lLastY;
                        lLastX = t.clientX;
                        lLastY = t.clientY;
                        // pendingDX/DY are raw pixel deltas (same unit as mouse movementX/Y)
                        // pointerSpeed in updateCamera converts them to radians
                        pendingDX += dx;
                        pendingDY += dy;
                        needsRender = true;
                    }
                }
            }, { passive: false });

            function lookRelease(e) {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    if (t.identifier === lTouchId) lTouchId = null;
                }
            }
            lookEl.addEventListener('touchend',    lookRelease, { passive: false });
            lookEl.addEventListener('touchcancel', lookRelease, { passive: false });
        })();

        // =====================================================
        // PHONE WEBXR — tap screen to walk forward
        // In phone WebXR (Cardboard-style) the touchscreen is still active.
        // A tap-and-hold moves the player forward; head movement steers.
        // =====================================================
        document.addEventListener('touchstart', (e) => {
            if (renderer.xr.isPresenting && currentMode === 'game') {
                moveState.xrTap = true;
                needsRender = true;
            }
        }, { passive: true });
        document.addEventListener('touchend', () => {
            if (renderer.xr.isPresenting) moveState.xrTap = false;
        }, { passive: true });
        document.addEventListener('touchcancel', () => {
            if (renderer.xr.isPresenting) moveState.xrTap = false;
        }, { passive: true });

        // =====================================================
        // ANIMATION LOOP
        // =====================================================
        
        let prevTime = performance.now();

        function updateCamera(delta) {
            if (currentMode === 'game') {
                let moveStep = 0;
                let turned = false;
                
                // Forward/backward movement in facing direction
                const fwd  = moveState.forward  || xrStickState.forward;
                const bwd  = moveState.backward || xrStickState.backward;
                const lft  = moveState.left     || xrStickState.left;
                const rgt  = moveState.right    || xrStickState.right;
                // Analog speed: proportional to stick deflection (1.0 when fully pushed)
                const stickMag = Math.min(1, Math.abs(xrStickState.axisY) > 0.18 ? Math.abs(xrStickState.axisY) : 1);
                if (fwd)  moveStep -= moveSpeed * delta * 60 * stickMag;
                if (bwd)  moveStep += moveSpeed * delta * 60 * stickMag;
                
                if (moveStep !== 0) {
                    // In XR, use the headset's actual facing direction for locomotion
                    // so WASD/joystick always moves where you are looking.
                    let moveYaw = yaw;
                    if (renderer.xr.isPresenting) {
                        const _xrDir = new THREE.Vector3();
                        renderer.xr.getCamera().getWorldDirection(_xrDir);
                        moveYaw = Math.atan2(_xrDir.x, _xrDir.z);
                    }
                    const nextX = camera.position.x + Math.sin(moveYaw) * moveStep;
                    const nextZ = camera.position.z + Math.cos(moveYaw) * moveStep;
                    
                    // Check collision before moving
                    if (!checkCollision(nextX, nextZ)) {
                        camera.position.x = nextX;
                        camera.position.z = nextZ;
                        needsRender = true;
                    }
                }
                
                // Turn left/right (in XR, head rotation handles look; A/D strafe instead)
                if (lft) {
                    if (renderer.xr.isPresenting) {
                        // Strafe left in XR
                        let moveYaw = yaw;
                        const _xrDir = new THREE.Vector3();
                        renderer.xr.getCamera().getWorldDirection(_xrDir);
                        moveYaw = Math.atan2(_xrDir.x, _xrDir.z);
                        const strafeYaw = moveYaw + Math.PI / 2;
                        const strafeMag = Math.min(1, Math.abs(xrStickState.axisX) > 0.18 ? Math.abs(xrStickState.axisX) : 1);
                        const nx = camera.position.x + Math.sin(strafeYaw) * moveSpeed * delta * 60 * strafeMag;
                        const nz = camera.position.z + Math.cos(strafeYaw) * moveSpeed * delta * 60 * strafeMag;
                        if (!checkCollision(nx, nz)) { camera.position.x = nx; camera.position.z = nz; }
                    } else {
                        yaw += turnSpeed * delta * 60;
                        turned = true;
                    }
                    needsRender = true;
                }
                if (rgt) {
                    if (renderer.xr.isPresenting) {
                        // Strafe right in XR
                        const _xrDir = new THREE.Vector3();
                        renderer.xr.getCamera().getWorldDirection(_xrDir);
                        const strafeMag = Math.min(1, Math.abs(xrStickState.axisX) > 0.18 ? Math.abs(xrStickState.axisX) : 1);
                        const strafeYaw = Math.atan2(_xrDir.x, _xrDir.z) - Math.PI / 2;
                        const nx = camera.position.x + Math.sin(strafeYaw) * moveSpeed * delta * 60 * strafeMag;
                        const nz = camera.position.z + Math.cos(strafeYaw) * moveSpeed * delta * 60 * strafeMag;
                        if (!checkCollision(nx, nz)) { camera.position.x = nx; camera.position.z = nz; }
                    } else {
                        yaw -= turnSpeed * delta * 60;
                        turned = true;
                    }
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
                // ── XR controller thumbstick input ─────────────────────────────
                // xrStickState is reset every frame then repopulated from axes so
                // releasing the stick immediately stops movement (no stuck-key bug).
                // Keyboard / BT state lives in moveState and is unaffected.
                xrStickState.forward  = false;
                xrStickState.backward = false;
                xrStickState.left     = false;
                xrStickState.right    = false;
                xrStickState.axisX    = 0;
                xrStickState.axisY    = 0;
                if (renderer.xr.isPresenting) {
                    const session = renderer.xr.getSession();
                    const DEAD = 0.18;
                    for (const src of session.inputSources) {
                        if (!src.gamepad) continue;
                        // Prefer left-hand controller for locomotion
                        if (src.handedness === 'right') continue;
                        const axes = src.gamepad.axes;
                        // xr-standard: axes[2]=thumbstick X, axes[3]=thumbstick Y
                        // Fallback to axes[0]/[1] for simpler controllers
                        const ax = axes.length > 3 ? axes[2] : (axes[0] ?? 0);
                        const ay = axes.length > 3 ? axes[3] : (axes[1] ?? 0);
                        if (Math.abs(ax) > Math.abs(xrStickState.axisX)) xrStickState.axisX = ax;
                        if (Math.abs(ay) > Math.abs(xrStickState.axisY)) xrStickState.axisY = ay;
                        if (ay < -DEAD) xrStickState.forward  = true;
                        if (ay >  DEAD) xrStickState.backward = true;
                        if (ax < -DEAD) xrStickState.left     = true;
                        if (ax >  DEAD) xrStickState.right    = true;
                    }
                    // Right thumbstick → look/turn (yaw only in XR since pitch = head)
                    for (const src of session.inputSources) {
                        if (!src.gamepad || src.handedness !== 'right') continue;
                        const axes = src.gamepad.axes;
                        const ax = axes.length > 3 ? axes[2] : (axes[0] ?? 0);
                        const LOOK_DEAD = 0.2;
                        if (Math.abs(ax) > LOOK_DEAD) {
                            yaw -= ax * turnSpeed * 1.5;
                            needsRender = true;
                        }
                    }
                    // Phone WebXR: tap-and-hold on screen = walk forward
                    if (moveState.xrTap) xrStickState.forward = true;
                }
                // ──────────────────────────────────────────────────────────────

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

        function initExteriorFacades() {
            if (exteriorFacadesAdded) return;
            exteriorFacadesAdded = true;

            const exteriorFacadeHeight = 31;
            const exteriorFacadeCenterY = 12.9;

            const frontFacade = createBrickFacade(46.6, exteriorFacadeHeight, 0.5);
            frontFacade.position.set(-20.38, exteriorFacadeCenterY, 32.8);
            scene.add(frontFacade);
            addObjectCollider(frontFacade);

            const backFacade = createBrickFacade(85.35, exteriorFacadeHeight, 0.02);
            backFacade.position.set(-.9, exteriorFacadeCenterY, -142.5);
            backFacade.rotation.y = Math.PI;
            scene.add(backFacade);
            addObjectCollider(backFacade);

            const leftFacade = createBrickFacade(175.5, exteriorFacadeHeight, 0.5);
            leftFacade.position.set(-43.6, exteriorFacadeCenterY, -54.7);
            leftFacade.rotation.y = -Math.PI/2;
            scene.add(leftFacade);
            addObjectCollider(leftFacade);

            const rightFacade = createBrickFacade(185.8, exteriorFacadeHeight, 0.2);
            rightFacade.position.set(41.4, exteriorFacadeCenterY, -49.45);
            rightFacade.rotation.y = Math.PI / 2;
            scene.add(rightFacade);
            addObjectCollider(rightFacade);

            addExteriorBaseboard(46.6, exteriorFacadeHeight, 0.5, frontFacade.position, frontFacade.rotation.y);
            addExteriorBaseboard(85.35, exteriorFacadeHeight, 0.02, backFacade.position, backFacade.rotation.y);
            addExteriorBaseboard(175.5, exteriorFacadeHeight, 0.5, leftFacade.position, leftFacade.rotation.y, [-1]);
            addExteriorBaseboard(185.8, exteriorFacadeHeight, 0.2, rightFacade.position, rightFacade.rotation.y);
        }

        // Exterior black baseboard (about 4") along facade bottoms.
        const baseboardMaterial = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.75,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        function addExteriorBaseboard(length, wallHeight, wallDepth, wallPos, wallRotY, dirs = [-1]) {
            const baseboardHeight = 0.88;
            const baseboardDepth = 0.22;
            const outward = new THREE.Vector3(Math.sin(wallRotY), 0, Math.cos(wallRotY));
            const offset = (wallDepth * 0.5) + (baseboardDepth * 0.5) + 0.08;
            const baseY = Math.max(
                wallPos.y - (wallHeight * 0.5) + (baseboardHeight * 0.5) + 0.12,
                -1.65
            );

            dirs.forEach((dir) => {
                const board = new THREE.Mesh(
                    new THREE.BoxGeometry(length, baseboardHeight, baseboardDepth),
                    baseboardMaterial
                );
                board.rotation.y = wallRotY;
                board.position.set(
                    wallPos.x + outward.x * offset * dir,
                    baseY,
                    wallPos.z + outward.z * offset * dir
                );
                board.castShadow = true;
                board.receiveShadow = true;
                scene.add(board);
            });
        }

        // ── Manual walls ─────────────────────────────────────────────────────
        // Adjust position / rotation / scale below to place each wall.
        (function addManualWalls() {
            const wallMat = wallpaperMaterial.clone();

            const wall20 = new THREE.Mesh(new THREE.BoxGeometry(65, 26.29, 4), wallMat.clone());
            wall20.name = 'Wall20';
            wall20.position.set(7, 11.36, -87);
            wall20.rotation.set(0, 0, 0);
            scene.add(wall20);
            addDrywallGapShadowForWallMesh(wall20);
            addObjectCollider(wall20);
            manualWalls.push(wall20);

            const wall21 = new THREE.Mesh(new THREE.BoxGeometry(42, 26.29, 3.4), wallMat.clone());
            wall21.name = 'Wall21';
            wall21.position.set(-4, 11.36, -110);   // ← adjust
            wall21.rotation.set(0, 90 * Math.PI / 180, 0);     // ← adjust
            scene.add(wall21);
            addDrywallGapShadowForWallMesh(wall21);
            addObjectCollider(wall21);
            manualWalls.push(wall21);
        })();
        // ─────────────────────────────────────────────────────────────────────

        // Show content is deferred until the building finishes loading (see finalizeModelLoading).

        // =====================================================
        // SHOW LOADING FUNCTIONS
        // =====================================================

        function addItemLight(object) {
            // No per-item spotlights - using gallery-wide lighting instead
        }

        function getItemScaleVec(item) {
            const s = item?.scale;
            if (typeof s === 'number') {
                return { x: s, y: s, z: s };
            }
            return {
                x: s?.x ?? 1,
                y: s?.y ?? 1,
                z: s?.z ?? 1
            };
        }

        function getItemRotationVec(item) {
            const r = item?.rotation || {};
            return {
                x: r.x ?? 0,
                y: r.y ?? 0,
                z: r.z ?? 0
            };
        }

        function getItemPositionVec(item) {
            const p = item?.position || {};
            return {
                x: p.x ?? 0,
                y: p.y ?? 0,
                z: p.z ?? 0
            };
        }

        let mediaPlaybackUnlockBound = false;
        function ensureMediaPlaybackUnlocked() {
            if (mediaPlaybackUnlockBound) return;
            mediaPlaybackUnlockBound = true;

            const resumeAllMedia = () => {
                if (audioListener?.context?.state === 'suspended') {
                    audioListener.context.resume().then(() => {
                        // Re-set volumes after context resumes so positional audio is audible
                        for (const pa of positionalAudios) {
                            if (pa._baseVolume !== undefined) {
                                pa.setVolume(currentMode === 'game' ? pa._baseVolume : 0);
                            }
                        }
                    });
                }
                for (const vo of videoObjects) {
                    vo.video.muted = false;
                    vo.video.play().catch(() => {});
                }
            };

            document.addEventListener('click', resumeAllMedia, { once: true });
            document.addEventListener('pointerdown', resumeAllMedia, { once: true });
            document.addEventListener('keydown', resumeAllMedia, { once: true });
        }

        function getWallMesh(wallName) {
            if (!wallName || wallName === 'none') return null;
            // Preserve original authoring behavior: use source GLB walls for placement.
            // Replacement planes are visual-only and may have different offsets/dimensions.
            // Check manually-added walls (Wall20, Wall21, …) first.
            const manual = manualWalls.find(w => w.name === wallName);
            if (manual) return manual;
            if (!modelScene) return null;
            let wallMesh = null;
            modelScene.traverse(child => { if (child.name === wallName) wallMesh = child; });
            if (wallMesh) return wallMesh;
            const placementWall = wallPlacementMeshes.get(wallName);
            if (placementWall?.mesh) return placementWall.mesh;
            return wallMesh;
        }

        function getWallPlacementFrame(wallName, options = {}) {
            if (!wallName || wallName === 'none') return null;

            const wallMesh = getWallMesh(wallName);
            if (!wallMesh) return null;

            const faceMesh = getInteriorPlacementMesh(wallName);
            let planeW, planeH, planePos, planeRot;
            let minAxis, alongAxis, center, size;

            if (faceMesh) {
                planeW = faceMesh.geometry.parameters.width;
                planeH = faceMesh.geometry.parameters.height;
                planePos = faceMesh.position.clone();
                planeRot = faceMesh.rotation.clone();

                // Derive minAxis from the plane normal — the axis the plane faces along.
                const faceNormal = new THREE.Vector3(0, 0, 1).applyEuler(planeRot);
                // The axis with the largest absolute normal component is the thin (depth) axis.
                minAxis = Math.abs(faceNormal.x) > Math.abs(faceNormal.z) ? 'x' : 'z';
                alongAxis = minAxis === 'x' ? 'z' : 'x';

                // Use planePos as center — art and grid origin is the registered plane center.
                center = planePos.clone();
                size = new THREE.Vector3(planeW, planeH, planeW); // approximate, not used for placement
            } else {
                wallMesh.updateWorldMatrix(true, false);
                const bbox = new THREE.Box3().setFromObject(wallMesh);
                center = bbox.getCenter(new THREE.Vector3());
                size = bbox.getSize(new THREE.Vector3());
                minAxis = size.x < size.z ? 'x' : 'z';
                alongAxis = minAxis === 'x' ? 'z' : 'x';

                const computed = computeDisplayPlaneFromWallMesh(wallName, wallMesh);
                planeW = computed.planeW;
                planeH = computed.planeH;
                planePos = computed.planePos;
                planeRot = computed.planeRot;
                center = planePos.clone();
            }

            // Determine the inward sign from the plane face normal component on minAxis.
            // For the fallback path (no faceMesh), use autoSign or WALL_INWARD_SIGN_DEFAULTS.
            let inwardBaseSign;
            if (faceMesh) {
                const faceNormal = new THREE.Vector3(0, 0, 1).applyEuler(planeRot);
                const axisComponent = minAxis === 'x' ? faceNormal.x : faceNormal.z;
                inwardBaseSign = axisComponent >= 0 ? 1 : -1;
            } else {
                const autoSign = minAxis === 'x'
                    ? (center.x > 0 ? -1 : 1)
                    : (center.z > 0 ? -1 : 1);
                inwardBaseSign = WALL_INWARD_SIGN_DEFAULTS[wallName] !== undefined
                    ? WALL_INWARD_SIGN_DEFAULTS[wallName]
                    : autoSign;
            }
            const effectiveFace = options.face !== undefined
                ? options.face
                : (WALL_FACE_DEFAULTS[wallName] ?? 1);
            const inwardSign = (effectiveFace === -1) ? -inwardBaseSign : inwardBaseSign;

            const isPrismWall = faceMesh?.userData?.prismInterior === true ||
                ['Wall2', 'Wall12', 'Wall13'].includes(wallName);

            // Derive inwardNormal from the plane rotation and force it to agree with inwardSign.
            const inwardNormal = new THREE.Vector3(0, 0, 1).applyEuler(planeRot);
            {
                const axisVec = minAxis === 'x'
                    ? new THREE.Vector3(inwardSign, 0, 0)
                    : new THREE.Vector3(0, 0, inwardSign);
                if (inwardNormal.dot(axisVec) < 0) inwardNormal.negate();
            }

            const guideOffset = isPrismWall ? 0.2 : GUIDE_SURFACE_OFFSET;
            const guideSurfacePos = planePos.clone().addScaledVector(inwardNormal, guideOffset);
            const isPartition = WALL_PARTITION_WALLS.has(wallName);
            const gridWorldYMin = WALL_PLANE_FLOOR_Y;
            const gridWorldYMax = isPartition
                ? WALL_PLANE_FLOOR_Y + WALL_PLANE_PARTITION_H
                : WALL_PLANE_CEIL_Y;

            // Use the registered plane center as the coordinate origin.
            // planePos IS the visible wall surface center, so art at {x:0,y:0} lands here,
            // the grid crosshair sits here, and the HUD reports offsets from here.
            // This eliminates drift between the GLB bbox center and the actual plane position.
            const origin = planePos.clone();
            // originAlong/originY are always 0 — the plane IS centered on the surface.
            const originAlong = 0;
            const originY = 0;

            return {
                wallName,
                wallMesh,
                center: origin,   // expose as center so positionOnWall uses planePos
                size,
                minAxis,
                alongAxis,
                inwardSign,
                inwardNormal,
                planeW,
                planeH,
                planePos,
                planeRot,
                guideSurfacePos,
                gridWorldYMin,
                gridWorldYMax,
                alongHalf: planeW / 2,
                heightHalf: planeH / 2,
                originAlong,
                originY,
                surfaceOffset: DEFAULT_WALL_SURFACE_OFFSET
            };
        }

        function resolveWallPlacementData(item) {
            const frame = getWallPlacementFrame(item?.wall, { face: item?.face });
            if (!frame) return null;
            return {
                wallMesh: frame.wallMesh,
                bbox: frame.bbox,
                center: frame.center,
                size: frame.size,
                minAxis: frame.minAxis,
                inwardSign: frame.inwardSign,
                wallName: frame.wallName
            };
        }

        function collectPlacableWallNames() {
            for (const w of manualWalls) {
                ensureManualWallPlacementPlane(w);
            }
            const names = new Set();
            for (const wallName of wallPlacementMeshes.keys()) {
                if (getInteriorPlacementMesh(wallName)) names.add(wallName);
            }
            return [...names].sort((a, b) => {
                const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
                const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
                return na - nb;
            });
        }

        function disposeWallGuideGroup() {
            wallGuideGroup.traverse(obj => {
                if (obj.isMesh) {
                    obj.geometry?.dispose();
                    if (obj.material?.map) obj.material.map.dispose();
                    obj.material?.dispose();
                }
                if (obj.isLine || obj.isLineSegments) {
                    obj.geometry?.dispose();
                    obj.material?.dispose();
                }
                if (obj.isSprite) {
                    if (obj.material?.map) obj.material.map.dispose();
                    obj.material?.dispose();
                }
            });
            wallGuideGroup.clear();
        }

        function planeLocalToWorld(planePos, planeRot, localX, localY, localZ, target) {
            target.set(localX, localY, localZ);
            target.applyEuler(planeRot);
            target.add(planePos);
            return target;
        }

        function buildWallGuideLineGrid(frame) {
            const { alongHalf, heightHalf, originAlong, originY, planePos, gridWorldYMin, gridWorldYMax } = frame;
            const step = LAYOUT_GUIDE_GRID_STEP;
            const verts = [];
            const pushSeg = (x0, y0, x1, y1, z = GUIDE_LINE_LOCAL_Z) => { verts.push(x0, y0, z, x1, y1, z); };

            // Vertical lines — counted in steps from the origin along-axis.
            const metaMinAlong = -alongHalf - originAlong;
            const metaMaxAlong = alongHalf - originAlong;
            for (let metaAlong = Math.floor(metaMinAlong / step) * step; metaAlong <= Math.ceil(metaMaxAlong / step) * step; metaAlong += step) {
                const lx = metaAlong + originAlong;
                if (lx < -alongHalf - 0.01 || lx > alongHalf + 0.01) continue;
                const major = Math.abs(metaAlong) < 0.01;
                pushSeg(lx, -heightHalf, lx, heightHalf);
                if (major) {
                    pushSeg(lx - 0.4, originY, lx + 0.4, originY);
                }
            }

            // Horizontal lines — anchored to shared world-Y ticks so lines align across all
            // walls at the same floor-relative heights. localY converts world-Y into the
            // surface group's local Y space (surface.position.y = planePos.y).
            for (let worldY = gridWorldYMin; worldY <= gridWorldYMax + 0.001; worldY += step) {
                const ly = worldY - planePos.y;
                if (ly < -heightHalf - 0.01 || ly > heightHalf + 0.01) continue;
                // metaY is what goes in position.y in meta.json to place art at this height.
                const metaY = worldY - frame.center.y;
                const major = Math.abs(metaY) < 0.01;
                pushSeg(-alongHalf, ly, alongHalf, ly);
                if (major) {
                    pushSeg(originAlong - 0.4, ly, originAlong + 0.4, ly);
                }
            }

            pushSeg(originAlong - 1.0, originY, originAlong + 1.0, originY);
            pushSeg(originAlong, originY - 1.0, originAlong, originY + 1.0);
            for (let i = 0; i < 12; i++) {
                const a0 = (i / 12) * Math.PI * 2;
                const a1 = ((i + 1) / 12) * Math.PI * 2;
                const r = 0.75;
                pushSeg(
                    originAlong + Math.cos(a0) * r, originY + Math.sin(a0) * r,
                    originAlong + Math.cos(a1) * r, originY + Math.sin(a1) * r
                );
            }

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            const grid = new THREE.LineSegments(
                geom,
                new THREE.LineBasicMaterial({
                    color: 0x66eeff,
                    transparent: true,
                    opacity: 0.92,
                    depthTest: true,
                    depthWrite: false
                })
            );
            const originGeom = new THREE.BufferGeometry();
            originGeom.setAttribute('position', new THREE.Float32BufferAttribute([
                originAlong - 1.0, originY, GUIDE_LINE_LOCAL_Z + 0.02, originAlong + 1.0, originY, GUIDE_LINE_LOCAL_Z + 0.02,
                originAlong, originY - 1.0, GUIDE_LINE_LOCAL_Z + 0.02, originAlong, originY + 1.0, GUIDE_LINE_LOCAL_Z + 0.02
            ], 3));
            const originCross = new THREE.LineSegments(
                originGeom,
                new THREE.LineBasicMaterial({
                    color: 0xffe066,
                    transparent: true,
                    opacity: 1,
                    depthTest: true,
                    depthWrite: false
                })
            );
            const group = new THREE.Group();
            group.add(grid);
            group.add(originCross);
            return group;
        }

        function createGuideFlatLabel(text, width = 4.2, height = 1.05) {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = 'bold 52px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 10;
            ctx.strokeStyle = '#000000';
            ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
            ctx.fillStyle = '#ffff66';
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            return new THREE.Mesh(
                new THREE.PlaneGeometry(width, height),
                new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    depthTest: true,
                    depthWrite: false,
                    side: THREE.DoubleSide
                })
            );
        }

        function addOriginAxesArrows(gridRoot, frame) {
            const { originAlong, originY, alongAxis, minAxis } = frame;
            const z = GUIDE_LINE_LOCAL_Z + 0.08;
            const SHAFT_LEN = 3.5;
            const SHAFT_R   = 0.09;
            const HEAD_LEN  = 0.75;
            const HEAD_R    = 0.22;
            const LABEL_OFF = 0.9; // extra gap beyond arrow tip for label

            // axis: { dir [x,y,z], color hex, label string }
            const hAxis = alongAxis === 'x' ? 'x' : 'z';
            const depthAxis = minAxis; // the axis perpendicular to the wall face
            const axes = [
                { dir: [ 1,  0, 0], color: 0xff4444, label: `${hAxis}+` },
                { dir: [-1,  0, 0], color: 0xff8888, label: `${hAxis}-` },
                { dir: [ 0,  1, 0], color: 0x44ff44, label: 'y+' },
                { dir: [ 0, -1, 0], color: 0x88ff88, label: 'y-' },
                { dir: [ 0,  0, 1], color: 0x44aaff, label: `${depthAxis}+ (depth)` },
            ];

            axes.forEach(({ dir, color, label }) => {
                const mat = new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.92,
                    depthTest: true,
                    depthWrite: false
                });

                // Shaft
                const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, SHAFT_LEN, 8), mat);
                // Cone head at tip
                const head = new THREE.Mesh(new THREE.ConeGeometry(HEAD_R, HEAD_LEN, 8), mat);

                // Default CylinderGeometry/ConeGeometry points along +Y.
                // Rotate so it points along dir, then translate to correct position.
                const tipDist = SHAFT_LEN + HEAD_LEN;
                const [dx, dy, dz] = dir;

                if (dx !== 0) {
                    shaft.rotation.z = -Math.PI / 2 * dx;
                    head.rotation.z  = -Math.PI / 2 * dx;
                    shaft.position.set(originAlong + dx * SHAFT_LEN / 2, originY, z);
                    head.position.set( originAlong + dx * tipDist,       originY, z);
                } else if (dz !== 0) {
                    shaft.rotation.x = Math.PI / 2;
                    head.rotation.x  = Math.PI / 2;
                    shaft.position.set(originAlong, originY, z + dz * SHAFT_LEN / 2);
                    head.position.set( originAlong, originY, z + dz * tipDist);
                } else {
                    // y-axis — default orientation, just translate
                    shaft.position.set(originAlong, originY + dy * SHAFT_LEN / 2, z);
                    head.position.set( originAlong, originY + dy * tipDist,       z);
                }

                gridRoot.add(shaft);
                gridRoot.add(head);

                // Label at tip
                const labelMesh = createGuideFlatLabel(label, 2.8, 0.9);
                if (dx !== 0) {
                    labelMesh.position.set(originAlong + dx * (tipDist + LABEL_OFF), originY + 1.2, z);
                } else if (dz !== 0) {
                    labelMesh.position.set(originAlong + 1.8, originY + 1.2, z + dz * (tipDist + LABEL_OFF));
                } else {
                    labelMesh.position.set(originAlong + 1.8, originY + dy * (tipDist + LABEL_OFF), z);
                }
                gridRoot.add(labelMesh);
            });
        }

        function addWallGuideGridLabels(gridRoot, frame) {
            const { alongHalf, heightHalf, originAlong, originY, alongAxis } = frame;
            const step = LAYOUT_GUIDE_GRID_STEP;
            const z = GUIDE_LINE_LOCAL_Z + 0.05;
            const labelY = -heightHalf + 1.4;

            // Horizontal axis labels (along the wall width).
            for (let metaAlong = Math.ceil((-alongHalf - originAlong) / step) * step; metaAlong <= Math.floor((alongHalf - originAlong) / step) * step; metaAlong += step) {
                if (Math.abs(metaAlong) < 0.01) continue;
                const lx = metaAlong + originAlong;
                const label = createGuideFlatLabel(`${alongAxis}${metaAlong > 0 ? '+' : ''}${Math.round(metaAlong)}`);
                label.position.set(lx, labelY, z);
                gridRoot.add(label);
            }

            // Vertical axis labels — mirror world-Y anchored horizontal lines so each label
            // sits on its line and reads the meta.json y value (worldY - center.y).
            for (let worldY = frame.gridWorldYMin; worldY <= frame.gridWorldYMax + 0.001; worldY += step) {
                const ly = worldY - frame.planePos.y;
                if (ly < -heightHalf + 0.01 || ly > heightHalf - 0.01) continue;
                const metaY = worldY - frame.center.y;
                if (Math.abs(metaY) < 0.01) continue;
                const label = createGuideFlatLabel(`y${metaY > 0 ? '+' : ''}${Math.round(metaY)}`);
                label.position.set(-alongHalf + 1.5, ly, z);
                gridRoot.add(label);
            }

            const originLabel = createGuideFlatLabel('0,0', 4.8, 1.2);
            originLabel.position.set(originAlong, originY + 1.8, z);
            gridRoot.add(originLabel);
        }

        function createGuideNameLabel(worldPos, text) {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = 'bold 56px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 12;
            ctx.strokeStyle = '#000000';
            ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
            ctx.fillStyle = '#7dffcb';
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: true,
                depthWrite: false
            }));
            sprite.position.copy(worldPos);
            sprite.scale.set(12, 3, 1);
            return sprite;
        }

        function createWallGuideForWall(wallName) {
            const frame = getWallPlacementFrame(wallName);
            if (!frame) return null;

            const {
                center, planeW, planeH, planeRot, guideSurfacePos,
                inwardNormal, minAxis, inwardSign,
                originAlong, originY, alongHalf, heightHalf
            } = frame;

            const group = new THREE.Group();
            group.name = 'WallGuide_' + wallName;

            // Build a rotation so the guide surface's local +Z faces the art side (inwardSign direction).
            // planeRot puts local +Z along the plane face normal; if that disagrees with inwardNormal
            // (e.g. Wall10 where the plane faces +X but art goes on the -X side), rotate 180° around Y.
            const guideRot = planeRot.clone();
            const planeLocalZ = new THREE.Vector3(0, 0, 1).applyEuler(planeRot);
            const artAxisVec = minAxis === 'x'
                ? new THREE.Vector3(inwardSign, 0, 0)
                : new THREE.Vector3(0, 0, inwardSign);
            if (planeLocalZ.dot(artAxisVec) < 0) {
                guideRot.y += Math.PI;
            }

            const surface = new THREE.Group();
            surface.position.copy(guideSurfacePos);
            surface.rotation.copy(guideRot);

            const gridRoot = new THREE.Group();
            gridRoot.add(buildWallGuideLineGrid(frame));
            addOriginAxesArrows(gridRoot, frame);

            const pickPlane = new THREE.Mesh(
                new THREE.PlaneGeometry(planeW, planeH),
                new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
            );
            pickPlane.userData.wallGuide = frame;
            gridRoot.add(pickPlane);

            addWallGuideGridLabels(gridRoot, frame);
            surface.add(gridRoot);
            group.add(surface);

            const namePos = new THREE.Vector3(center.x, frame.gridWorldYMax + 3.5, center.z);
            group.add(createGuideNameLabel(namePos, wallName));

            return group;
        }

        function buildWallPlacementGuides() {
            disposeWallGuideGroup();
            if (!layoutGuideEnabled) {
                wallGuideGroup.visible = false;
                return;
            }

            wallGuideGroup.visible = true;
            for (const wallName of collectPlacableWallNames()) {
                const guide = createWallGuideForWall(wallName);
                if (guide) wallGuideGroup.add(guide);
            }
        }

        function wallHitToMetaPosition(hitPoint, guideData) {
            const { center } = guideData;
            const round1 = (v) => Math.round(v * 10) / 10;
            return {
                x: round1(hitPoint.x - center.x),
                y: round1(hitPoint.y - center.y),
                z: round1(hitPoint.z - center.z)
            };
        }

        const layoutGuideRaycaster = new THREE.Raycaster();
        const layoutGuidePointer = new THREE.Vector2();

        function updateLayoutGuideHud(clientX, clientY) {
            if (!layoutGuideEnabled || !layoutGuideHud) return;

            layoutGuidePointer.x = (clientX / window.innerWidth) * 2 - 1;
            layoutGuidePointer.y = -(clientY / window.innerHeight) * 2 + 1;
            layoutGuideRaycaster.setFromCamera(layoutGuidePointer, camera);
            const hits = layoutGuideRaycaster.intersectObjects(wallGuideGroup.children, true);
            if (!hits.length) {
                layoutGuideHud.innerHTML = '<strong>Layout Guide</strong><br>Point at a wall grid to read coordinates.';
                return;
            }

            const hit = hits[0];
            const frame = hit.object.userData.wallGuide;
            if (!frame) return;
            const pos = wallHitToMetaPosition(hit.point, frame);
            // Clarify which axis label carries the horizontal offset for this wall.
            const hAxis = frame.alongAxis; // 'x' or 'z' — the wall-width axis
            layoutGuideHud.innerHTML =
                `<strong>${frame.wallName}</strong><br>` +
                `"wall": "${frame.wallName}",<br>` +
                `"position": { "x": ${pos.x}, "y": ${pos.y}, "z": ${pos.z} }<br>` +
                `<span style="color:#8de9ff">0,0 = wall center &nbsp;|&nbsp; horizontal → ${hAxis} &nbsp;|&nbsp; vertical → y &nbsp;|&nbsp; grid step = ${LAYOUT_GUIDE_GRID_STEP}</span>`;
        }

        document.addEventListener('mousemove', (event) => {
            if (layoutGuideEnabled) updateLayoutGuideHud(event.clientX, event.clientY);
        });

        function ensureObjectInFrontOfWall(object, wallData) {
            if (!object || !wallData) return;
            object.updateWorldMatrix(true, true);
            const objBox = new THREE.Box3().setFromObject(object);
            const axis = wallData.minAxis;
            // center is now planePos — the wall face is at center[axis] exactly.
            const wallFace = wallData.center[axis];
            const objNearFace = wallData.inwardSign > 0 ? objBox.min[axis] : objBox.max[axis];
            const gap = wallData.inwardSign > 0 ? (objNearFace - wallFace) : (wallFace - objNearFace);
            const minGap = 0.03;

            if (gap < minGap) {
                object.position[axis] += wallData.inwardSign * (minGap - gap + 0.001);
            }
        }

        function positionOnWall(object, item) {
            const DEG2RAD = Math.PI / 180;
            const itemPos = getItemPositionVec(item);
            const itemRot = getItemRotationVec(item);
            if (item.wall === 'none' || !item.wall) {
                // Direct positioning (e.g., on floor)
                object.position.set(itemPos.x, itemPos.y, itemPos.z);
                object.rotation.set(itemRot.x * DEG2RAD, itemRot.y * DEG2RAD, itemRot.z * DEG2RAD);
                return;
            }

            const frame = getWallPlacementFrame(item.wall, { face: item.face });
            if (!frame) {
                console.warn('Wall not found:', item.wall);
                object.position.set(itemPos.x, itemPos.y, itemPos.z);
                object.rotation.set(itemRot.x * DEG2RAD, itemRot.y * DEG2RAD, itemRot.z * DEG2RAD);
                return;
            }

            const { center, minAxis, inwardSign } = frame;
            const surfaceOffset = Number.isFinite(item.surfaceOffset) ? item.surfaceOffset : frame.surfaceOffset;

            if (minAxis === 'x') {
                object.rotation.y = inwardSign > 0 ? Math.PI / 2 : -Math.PI / 2;
            } else {
                object.rotation.y = inwardSign > 0 ? 0 : Math.PI;
            }

            object.rotation.x += itemRot.x * DEG2RAD;
            object.rotation.y += itemRot.y * DEG2RAD;
            object.rotation.z += itemRot.z * DEG2RAD;

            // center is now planePos (the registered wall surface plane center).
            // Offset from it by itemPos + a small surfaceOffset in the inward direction.
            object.position.set(
                center.x + itemPos.x + (minAxis === 'x' ? inwardSign * surfaceOffset : 0),
                center.y + itemPos.y + 7.5,
                center.z + itemPos.z + (minAxis === 'z' ? inwardSign * surfaceOffset : 0)
            );


            ensureObjectInFrontOfWall(object, frame);
        }

        function liftObjectAboveFloor(object, item) {
            if (!object || item?.allowBelowFloor === true) return;
            if (item?.autoFloorClamp === false) return;
            const FLOOR_SURFACE_Y = -1.74;
            const box = new THREE.Box3().setFromObject(object);
            if (!Number.isFinite(box.min.y)) return;
            if (box.min.y < FLOOR_SURFACE_Y) {
                object.position.y += (FLOOR_SURFACE_Y - box.min.y);
            }
        }

        function addImageToScene(item, showTitle) {
            const imageGroup = new THREE.Group();
            const itemScale = getItemScaleVec(item);
            const material = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.01, metalness: 0.1, roughness: 0.8, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
           // plane.castShadow = true;  // Enable shadow casting
           // plane.receiveShadow = true;  // Enable shadow receiving
            imageGroup.add(plane);

            const finalizeImagePlacement = () => {
                positionOnWall(imageGroup, item);
                liftObjectAboveFloor(imageGroup, item);
                needsRender = true;
            };

            textureLoader.load(buildShowAssetPath(showTitle, item.src), (tex) => {
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

                // Normalize frame descriptors.
                // Accepts three forms (all backward-compatible):
                //   "frame": "aluminum"                   → [{ type:"aluminum" }]
                //   "frame": "whiteboard, poster1"         → [{ type:"whiteboard" }, { type:"poster1" }]
                //   "frames": [{ type:"poster1", offset:{x:0,y:0,z:0.1}, rotation:{}, scale:1 }, ...]
                const DEG2RAD = Math.PI / 180;
                const frameDescriptors = Array.isArray(item.frames)
                    ? item.frames
                    : (item.frame || '').split(',')
                        .map(f => f.trim())
                        .filter(f => f && f !== 'none')
                        .map(f => ({ type: f }));

                for (const fd of frameDescriptors) {
                    const frameRaw = (fd.type || '').trim();
                    const frame = frameRaw.toLowerCase();
                    if (!frame || frame === 'none') continue;
                    // Each frame gets its own sub-group so per-frame offset/rotation/scale apply
                    // only to that frame's geometry, not to the image plane itself.
                    const frameGroup = new THREE.Group();
                    if (fd.offset) {
                        // offset is in world units — divide by imageGroup's scale so the
                        // parent's scale doesn't shrink the value (imageGroup.scale = item.scale).
                        const isx = (typeof item.scale === 'number') ? item.scale : (item.scale?.x || 1);
                        const isy = (typeof item.scale === 'number') ? item.scale : (item.scale?.y || 1);
                        const isz = (typeof item.scale === 'number') ? item.scale : (item.scale?.z || 1);
                        frameGroup.position.set(
                            (fd.offset.x ?? 0) / isx,
                            (fd.offset.y ?? 0) / isy,
                            (fd.offset.z ?? 0) / isz
                        );
                    }
                    if (fd.rotation) frameGroup.rotation.set((fd.rotation.x ?? 0) * DEG2RAD, (fd.rotation.y ?? 0) * DEG2RAD, (fd.rotation.z ?? 0) * DEG2RAD);
                    if (fd.scale != null) {
                        if (typeof fd.scale === 'number') frameGroup.scale.setScalar(fd.scale);
                        else frameGroup.scale.set(fd.scale.x ?? 1, fd.scale.y ?? 1, fd.scale.z ?? 1);
                    }
                    imageGroup.add(frameGroup);
                    if (frame === 'fabric') {
                        // Draped tapestry: image printed on fabric, hanging from a wall rod
                        material.roughness = 0.93;
                        material.metalness = 0.0;
                        const fabricRepeatX = Math.max(1, w / 12);
                        const fabricRepeatY = Math.max(1, h / 12);
                        const fabricNormal = getFabricNormalTexture();
                        fabricNormal.repeat.set(fabricRepeatX, fabricRepeatY);
                        material.normalMap = fabricNormal;
                        material.normalScale = new THREE.Vector2(0.7, 0.7);
                        material.needsUpdate = true;

                        // Drape: replace flat plane with a subdivided mesh whose vertices are
                        // displaced to simulate vertical fabric folds + a gentle forward bow.
                        // Amplitudes are capped in world space so the fabric never pierces the wall.
                        const scaleMax = Math.max(itemScale.x, itemScale.y);
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
                        frameGroup.add(rod);
                        // Decorative finial knobs at each end of the rod
                        [-rodW * 0.5, rodW * 0.5].forEach(ex => {
                            const finial = new THREE.Mesh(new THREE.SphereGeometry(rodR * 1.5, 8, 6), rodMat);
                            finial.position.set(ex, h / 2 + rodR, rodR);
                            frameGroup.add(finial);
                        });
                    } else if (frame.endsWith('.glb')) {
                        // Custom GLB frame: drop a .glb in the show folder and reference it as "frame".
                        // Name the mesh that should receive the image "Image" — the code will scale
                        // the whole GLB so that mesh fits the loaded image dimensions exactly.
                        plane.visible = false;
                        gltfLoader.load(buildShowAssetPath(showTitle, frame), (gltf) => {
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
                            frameGroup.add(gltf.scene);
                            finalizeImagePlacement();
                        }, undefined, err => {
                            plane.visible = true;
                            console.warn('Custom frame GLB not found or failed to load:', buildShowAssetPath(showTitle, frame), err);
                            finalizeImagePlacement();
                        });
                    } else if (frame === 'whiteboard' || frame === 'whiteborder') {
                        // Flat white panel with padding on all sides; image sits flush on front face
                        material.roughness = 0.18;
                        material.metalness = 0.4;
                        material.needsUpdate = true;
                        const pad  = Math.max(w, h) * 0.04;  // padding on each side
                        const boxW = w + pad * 2;
                        const boxH = h + pad * 2;
                        const boxD = Math.max(w, h) * 0.03;
                        const panelMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f6, roughness: 0.82, metalness: 0.4 });
                        const panel = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), panelMat);
                        panel.castShadow = true;
                        panel.receiveShadow = true;
                        panel.position.set(0, 0, -boxD / 2 - boxD * 0.05);
                        frameGroup.add(panel);
                    } else if (frame === 'aluminum') {
                        // Metal frame bars around the image
                        const frameMat = new THREE.MeshStandardMaterial({ color: 0xbec2c8, metalness: 0.85, roughness: 0.25 });
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
                            frameGroup.add(bar);
                        });
                    } else {
                        // Named building asset: "poster1" → ./building/poster1.glb, etc.
                        // The flat plane keeps the texture; the GLB provides the frame border only.
                        // The GLB's own "Image" mesh is hidden to avoid double-rendering.
                        gltfLoader.load('./building/' + frame + '.glb', (gltf) => {
                            let imageMesh = null;
                            gltf.scene.traverse(child => {
                                if (child.isMesh) {
                                    child.castShadow = true;
                                    child.receiveShadow = true;
                                    if (child.name === 'Image' && !imageMesh) imageMesh = child;
                                }
                            });
                            if (!imageMesh) {
                                gltf.scene.traverse(child => {
                                    if (child.isMesh && !imageMesh) imageMesh = child;
                                });
                            }
                            if (imageMesh) {
                                // Hide the placeholder mesh; the flat plane already shows the texture.
                                imageMesh.visible = false;
                                const box = new THREE.Box3().setFromObject(imageMesh);
                                const meshSize = box.getSize(new THREE.Vector3());
                                const scaleX = meshSize.x > 0 ? w / meshSize.x : 1;
                                const scaleY = meshSize.y > 0 ? h / meshSize.y : 1;
                                gltf.scene.scale.setScalar(Math.min(scaleX, scaleY));
                            }
                            frameGroup.add(gltf.scene);
                            finalizeImagePlacement();
                        }, undefined, err => {
                            console.warn('Frame GLB not found: ./building/' + frame + '.glb', err);
                            finalizeImagePlacement();
                        });
                    }
                }

                finalizeImagePlacement();
            }, undefined, err => {
                console.error('Artwork image failed to load:', {
                    show: showTitle,
                    src: item.src,
                    wall: item.wall,
                    error: err
                });
            });

            imageGroup.scale.set(itemScale.x, itemScale.y, itemScale.z);
            finalizeImagePlacement();
            scene.add(imageGroup);
            if (item.collider === true) addObjectCollider(imageGroup);
            addItemLight(imageGroup);
        }

        function addModelToScene(item, showTitle) {
            gltfLoader.load(buildShowAssetPath(showTitle, item.src), (gltf) => {
                const model = gltf.scene;
                const itemScale = getItemScaleVec(item);
                model.scale.set(itemScale.x, itemScale.y, itemScale.z);
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
                liftObjectAboveFloor(model, item);
                addItemLight(model);
            }, undefined, error => {
                console.error('Error loading model:', error);
            });
        }

        function addVideoToScene(item, showTitle) {
            const video = document.createElement('video');
            const itemScale = getItemScaleVec(item);
            video.src = buildShowAssetPath(showTitle, item.src);
            video.crossOrigin = 'anonymous';
            video.loop = true;
            video.muted = true; // muted for autoplay; audio routed via Web Audio API
            video.playsInline = true;
            video.autoplay = true;

            // Resume AudioContext and media playback on first user interaction.
            ensureMediaPlaybackUnlocked();
            video.play().catch(() => {});  // Silent fail until user gesture

            const videoTex = new THREE.VideoTexture(video);
            videoTex.colorSpace = THREE.SRGBColorSpace;

            const w = item.width || 16;
            const h = item.height || 9;
            const isTransparentVideo = (item.opacity !== undefined && item.opacity < 1);
            const videoMaterial = new THREE.MeshBasicMaterial({
                map: videoTex,
                side: THREE.DoubleSide,
                transparent: isTransparentVideo,
                opacity: (item.opacity !== undefined) ? item.opacity : 1,
                depthWrite: !isTransparentVideo,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                videoMaterial
            );
            plane.scale.set(itemScale.x, itemScale.y, itemScale.z);
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
            if (item.wall === 'Wall10') {
                const wallData = resolveWallPlacementData(item);
                if (wallData) {
                    // Keep Wall10 videos safely in front of the visible wall skin.
                    plane.position[wallData.minAxis] += wallData.inwardSign * 0.08;
                    ensureObjectInFrontOfWall(plane, wallData);
                }
            }
            scene.add(plane);
            liftObjectAboveFloor(plane, item);

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
                // Video may already be playing before the listener was added — start immediately.
                if (!video.paused) scheduleVFC();
            }
            // Fallback (no VFC): animate loop sets needsRender only when !_distant.
        }

        function addTvToScene(item, showTitle) {
            // ── Video element ─────────────────────────────────────────────────
            const video = document.createElement('video');
            const itemScale = getItemScaleVec(item);
            video.src = buildShowAssetPath(showTitle, item.src);
            video.crossOrigin = 'anonymous';
            video.loop = true;
            video.muted = true; // must be muted for autoplay; audio routed via Web Audio API
            video.playsInline = true;
            video.autoplay = true;

            ensureMediaPlaybackUnlocked();
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
                if (!video.paused) scheduleVFC();
            }

            // ── TV GLB ────────────────────────────────────────────────────────
            // Always load the shared TV model; path is relative to the show folder.
            const tvGlb = item.type === 'tvalt' ? 'tvalt.glb' : 'tv.glb';
            gltfLoader.load('./building/' + tvGlb, (gltf) => {
                const model = gltf.scene;
                model.scale.set(itemScale.x, itemScale.y, itemScale.z);
                applyGLBMaterials(model, false);
                positionOnWall(model, item);
                scene.add(model);
                liftObjectAboveFloor(model, item);
                addObjectCollider(model);

                // Prefer a dedicated screen mesh if the GLB exposes one; this
                // makes the video sit on the actual display panel, not the TV body.
                // Must call after liftObjectAboveFloor so world matrix reflects final position.
                model.updateMatrixWorld(true, true);
                const modelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion);
                const screenNameRx = /(screen|display|monitor|panel|lcd|led)/i;
                let screenMesh = null;
                let bestArea = 0;
                model.traverse((child) => {
                    if (!child.isMesh || !screenNameRx.test(child.name || '')) return;
                    const box = new THREE.Box3().setFromObject(child);
                    const size = box.getSize(new THREE.Vector3());
                    const area = size.x * size.y + size.x * size.z + size.y * size.z;
                    if (area > bestArea) {
                        bestArea = area;
                        screenMesh = child;
                    }
                });

                // Fallback: if the GLB has no obvious screen-named mesh, choose the
                // most screen-like front-facing thin mesh on the model.
                if (!screenMesh) {
                    let bestScore = -Infinity;
                    model.traverse((child) => {
                        if (!child.isMesh) return;
                        const box = new THREE.Box3().setFromObject(child);
                        const size = box.getSize(new THREE.Vector3());
                        const center = box.getCenter(new THREE.Vector3());
                        const depthAlongForward =
                            Math.abs(modelForward.x) * size.x +
                            Math.abs(modelForward.y) * size.y +
                            Math.abs(modelForward.z) * size.z;
                        const areaLike = size.x * size.y + size.x * size.z + size.y * size.z;
                        const forwardness = center.dot(modelForward);
                        const score = (areaLike / Math.max(depthAlongForward, 1e-3)) + forwardness * 0.05;
                        if (score > bestScore) {
                            bestScore = score;
                            screenMesh = child;
                        }
                    });
                }

                const surfaceGap = (item.videoSurfaceOffset !== undefined) ? item.videoSurfaceOffset : 0.001;
                let screenWidth;
                let screenHeight;
                let screenQuat;
                let screenNormal;
                let planePos;

                if (screenMesh && screenMesh.geometry) {
                    if (!screenMesh.geometry.boundingBox) {
                        screenMesh.geometry.computeBoundingBox();
                    }
                    const localBox = screenMesh.geometry.boundingBox;
                    const localSize = localBox.getSize(new THREE.Vector3());
                    const localCenter = localBox.getCenter(new THREE.Vector3());
                    const worldScale = screenMesh.getWorldScale(new THREE.Vector3());

                    screenWidth = Math.abs(localSize.x * worldScale.x);
                    screenHeight = Math.abs(localSize.y * worldScale.y);

                    screenQuat = screenMesh.getWorldQuaternion(new THREE.Quaternion());
                    screenNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenQuat).normalize();
                    const worldCenter = localCenter.clone().applyMatrix4(screenMesh.matrixWorld);
                    const halfDepth = Math.abs(localSize.z * worldScale.z) * 0.5;
                    planePos = worldCenter.addScaledVector(screenNormal, halfDepth + surfaceGap);
                } else {
                    const bbox = new THREE.Box3().setFromObject(model);
                    const bboxCenter = bbox.getCenter(new THREE.Vector3());
                    const bboxSize = bbox.getSize(new THREE.Vector3());

                    screenQuat = model.quaternion.clone();
                    screenNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenQuat).normalize();
                    if (screenNormal.dot(modelForward) < 0) screenNormal.negate();

                    const halfExtents = bboxSize.clone().multiplyScalar(0.5);
                    const absN = new THREE.Vector3(
                        Math.abs(screenNormal.x),
                        Math.abs(screenNormal.y),
                        Math.abs(screenNormal.z)
                    );
                    const halfDepth = halfExtents.dot(absN);
                    planePos = bboxCenter.addScaledVector(screenNormal, halfDepth + surfaceGap);

                    const nx = Math.abs(screenNormal.x);
                    const ny = Math.abs(screenNormal.y);
                    const nz = Math.abs(screenNormal.z);
                    if (nz >= nx && nz >= ny) {
                        screenWidth = bboxSize.x; screenHeight = bboxSize.y;
                    } else if (nx >= ny) {
                        screenWidth = bboxSize.z; screenHeight = bboxSize.y;
                    } else {
                        screenWidth = bboxSize.x; screenHeight = bboxSize.z;
                    }
                }

                plane.position.copy(planePos);
                plane.quaternion.copy(screenQuat);

                // Apply optional per-item videoOffset (world-space x/y/z nudge)
                // and videoRotation (x/y/z degrees added on top of the TV rotation).
                // Use these in meta.json to correct the screen alignment for any TV.
                const DEG2RAD = Math.PI / 180;
                if (item.videoOffset) {
                    plane.position.x += item.videoOffset.x || 0;
                    plane.position.y += item.videoOffset.y || 0;
                    plane.position.z += item.videoOffset.z || 0;
                }
                if (item.videoOffsetLocal) {
                    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(plane.quaternion);
                    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(plane.quaternion);
                    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
                    plane.position
                        .addScaledVector(right, item.videoOffsetLocal.x || 0)
                        .addScaledVector(up, item.videoOffsetLocal.y || 0)
                        .addScaledVector(normal, item.videoOffsetLocal.z || 0);
                }
                if (item.videoRotation) {
                    plane.rotation.x += (item.videoRotation.x || 0) * DEG2RAD;
                    plane.rotation.y += (item.videoRotation.y || 0) * DEG2RAD;
                    plane.rotation.z += (item.videoRotation.z || 0) * DEG2RAD;
                }

                const vsRaw = item.videoScale ?? 1;
                const vsX = (typeof vsRaw === 'object') ? (vsRaw.x ?? 1) : vsRaw;
                const vsY = (typeof vsRaw === 'object') ? (vsRaw.y ?? 1) : vsRaw;
                const vsZ = (typeof vsRaw === 'object') ? (vsRaw.z ?? 1) : vsRaw;
                // Auto-fit the video plane to the detected screen face dimensions.
                plane.scale.set(screenWidth / vw * vsX, screenHeight / vh * vsY, vsZ);

                scene.add(plane);
            }, undefined, err => console.error('TV model load error:', err));
        }

        function loadShow() {
            if (!isBuildingReady) return;
            var hash = window.location.hash.replace('#', '');
            if (hash.length == 0) {
                return;
            }
            var showTitle = decodeURIComponent(hash);
            if (showTitle === BLANK_GALLERY_VALUE) {
                return;
            }
            if (showLoadInProgress || currentLoadedShow === showTitle) {
                return;
            }
            showLoadInProgress = true;
            
            fetch(buildShowAssetPath(showTitle, 'meta.json'))
                .then(response => response.json())
                .then(meta => {
                    if (!meta || !meta.media) {
                        throw new Error('Invalid meta.json format');
                    }
                    
                    meta.media.forEach(item => {
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
                    currentLoadedShow = showTitle;
                })
                .catch(error => {
                    console.error('Error loading show meta:', error);
                })
                .finally(() => {
                    showLoadInProgress = false;
                });
        }
