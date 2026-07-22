import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let camera, scene, renderer, controls, gui;
let seatMeshes = [];
let initialSeatAssignments = [];
const guiStats = {
    'Load Factor': '0.00%',
    'Revenue': '€0',
    'Reset Simulation': resetSimulation,
};
const flight = {
    totalSeats: 0,
    bookedSeats: 0,
    overbooking: 10,
    get capacity() {
        return Math.floor(this.totalSeats * (1 + this.overbooking / 100));
    },
    revenue: 0,
};

// --- CAMERA & ANIMATION ---
// Defines the different camera positions and targets for the tutorial steps.
const cameraViews = [
    {   // 0: Wide Shot - A general overview of the entire aircraft.
        position: new THREE.Vector3(-20, 30, 105),
        target: new THREE.Vector3(0, 10, 0)
    },
    {   // 1: Cabin View - A closer look from the side of the passenger cabin.
        position: new THREE.Vector3(0, -10, 60),
        target: new THREE.Vector3(0, 15, 0)
    },
    {   // 2: Cockpit View - A view from the right back, looking at the cockpit.
        position: new THREE.Vector3(-5, 5, -30),
        target: new THREE.Vector3(0, 15, 0)
    },
    {   // 3: Top-Down View - A view from above looking down at all the seats.
        position: new THREE.Vector3(0, 100, 120),
        target: new THREE.Vector3(0, 10, 0)
    }
];
const cameraAnimation = {
    active: false,
    alpha: 0,
    duration: 2, // seconds
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
};
let clock = new THREE.Clock();
const highlightColor = new THREE.Color(0x888888);
const baseEmissive = new THREE.Color(0x000000);


// --- INTERACTIVITY ---
let raycaster, mouse, tooltip, intersected, highlighted;
let mouseX = 0, mouseY = 0;
const HIGHLIGHT_COLOR = 0xffff00;

const AIRCRAFT_CONFIG = {
    rows: 27,
    seatsPerRow: 6,
    aisleGap: 2,
};

const simControls = {
    numToBook: 10,
    run: () => {
        for(let i = 0; i < simControls.numToBook; i++) {
            simulatePassengerBooking();
        }
    }
};

const bookingClasses = [
    { name: 'Y (Highest Fare)', price: 500, capacityRatio: 0.10, color: 0xff0000, booked: 0 },
    { name: 'B', price: 420, capacityRatio: 0.15, color: 0xff4500, booked: 0 },
    { name: 'M', price: 350, capacityRatio: 0.20, color: 0xffa500, booked: 0 },
    { name: 'H', price: 280, capacityRatio: 0.25, color: 0xffff00, booked: 0 },
    { name: 'Q (Lowest Fare)', price: 200, capacityRatio: 0.30, color: 0x9acd32, booked: 0 },
];
let aircraftGroup;

function createRunway() {
    const runwayWidth = 80;
    const runwayLength = 800;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 2048;
    const context = canvas.getContext('2d');

    // Base asphalt
    context.fillStyle = '#4a4a4a';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Centerline
    context.strokeStyle = '#ffffff';
    context.lineWidth = 5;
    context.setLineDash([80, 40]);
    context.beginPath();
    context.moveTo(canvas.width / 2, 0);
    context.lineTo(canvas.width / 2, canvas.height);
    context.stroke();

    // Edge lines
    context.setLineDash([]);
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(canvas.width * 0.1, 0);
    context.lineTo(canvas.width * 0.1, canvas.height);
    context.moveTo(canvas.width * 0.9, 0);
    context.lineTo(canvas.width * 0.9, canvas.height);
    context.stroke();


    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);

    const groundMat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
    });

    const groundGeom = new THREE.PlaneGeometry(runwayWidth, runwayLength);
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;

    ground.position.set(0,-15,0);
    scene.add(ground);
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 200, 600);


    createRunway();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.copy(cameraViews[0].position);
    

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 20;
    controls.maxDistance = 200;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.copy(cameraViews[0].target);


    const ambientLight = new THREE.HemisphereLight(0xddeeff, 0x0f0e0d, 1.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(40, 50, 20);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.camera.left = -80;
    dirLight.shadow.camera.right = 80;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 300;
    scene.add(dirLight);

    flight.totalSeats = AIRCRAFT_CONFIG.rows * AIRCRAFT_CONFIG.seatsPerRow;
    updateBookingClassCapacities();


    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    tooltip = document.getElementById('tooltip');
    document.addEventListener('mousemove', onMouseMove, false);

    document.getElementById('view1').addEventListener('click', () => tweenCamera(0));
    document.getElementById('view2').addEventListener('click', () => tweenCamera(1));
    document.getElementById('view3').addEventListener('click', () => tweenCamera(2));
    document.getElementById('view4').addEventListener('click', () => tweenCamera(3));

    loadGLTFModel();
    setupGUI();

    window.addEventListener('resize', onWindowResize);

    // --- TUTORIAL ---
    const tutorialSteps = [
        {
            text: "👋 Welcome to the Airline Revenue Management Simulator! This tutorial will guide you through the key features.",
            view: 0,
            action: () => {}
        },
        {
            text: "🖱️ You can control the camera with your mouse: <br> - <b>Left-click + drag</b> to rotate <br> - <b>Right-click + drag</b> to pan <br> - <b>Scroll</b> to zoom. <br> Go ahead and try it!",
            // view: 1,
            action: () => {}
        },
        {
            text: "✈️ All seats are color-coded by their booking class. You can hover over a seat to see its details.",
            // view: 1,
            action: () => {}
        },
        {
            text: "📸 Let's explore the preset camera views. Click the '1' button for a wide overview of the aircraft.",
            // view: 0,
            action: () => {
                highlightElement(document.getElementById('view1'));
            }
        },
        {
            text: "👍 Great! Now try button '2' for a closer look at the passenger cabin.",
            // view: 1,
            action: () => {
                highlightElement(document.getElementById('view2'));
            }
        },
        {
            text: "👍 Excellent! Button '3' gives you a view from the back cockpit.",
            // view: 2,
            action: () => {
                highlightElement(document.getElementById('view3'));
            }
        },
        {
            text: "🔍 And with button '4', you get a top-down strategic view of the entire cabin.",
            // view: 3,
            action: () => {
                highlightElement(document.getElementById('view4'));
            }
        },
        {
            text: "📊 Now, let's look at the control panel on the left. The 'Flight Status' section shows the current load factor and revenue.",
            view: 0,
            action: () => {
                gui.open();
                gui.folders[0].open();
                highlightElement(gui.folders[0].domElement);
            }
        },
        {
            text: "⚙️ The 'Simulation Controls' section is where you can run booking scenarios. Adjust the number of passengers and the overbooking to see different outcomes.",
            // view: 1,
            action: () => {
                gui.folders[0].close();
                gui.folders[1].open();
                highlightElement(gui.folders[1].domElement);
            }
        },
        {
            text: "💡 The 'Fine-Tune Strategy' section is key. Here you can adjust prices and seat allocations for each class to maximize revenue.",
            // view: 1,
            action: () => {
                gui.folders[1].close();
                gui.folders[2].open();
                highlightElement(gui.folders[2].domElement);
            }
        },
        {
            text: "🎉 You're ready to see how high you can get the revenue. Good luck!",
            // view: 0,
            action: () => {
                gui.open();
                gui.folders[0].open();
                gui.folders[1].open();
                gui.folders[2].close();
                /// gui.folders.forEach(f => f.open());
            }
        }
    ];

    let currentStep = 0;
    const tutorialContainer = document.getElementById('tutorial-container');
    const tutorialText = document.getElementById('tutorial-text');
    const tutorialNext = document.getElementById('tutorial-next');
    const startTutorialButton = document.getElementById('start-tutorial');

    function startTutorial() {
        currentStep = 0;
        document.getElementById('info').style.display = 'none';
        tutorialContainer.style.display = 'block';
        showTutorialStep();
    }

    function showTutorialStep() {
        unhighlightAllElements();
        const step = tutorialSteps[currentStep];
        tutorialText.innerHTML = step.text;

        if (step.view !== undefined) {
            const positionTolerance = 0.1; // meters
            const targetTolerance = 0.1; // meters

            const isPositionSame = camera.position.distanceTo(cameraViews[step.view].position) < positionTolerance;
            const isTargetSame = controls.target.distanceTo(cameraViews[step.view].target) < targetTolerance;

            // Only tween camera if the view is different from the current one (within tolerance)
            if (!isPositionSame || !isTargetSame) {
                tweenCamera(step.view);
                // Call action after camera animation
                setTimeout(step.action, cameraAnimation.duration * 1000 + 100); // Add a small buffer
            } else {
                // If no camera movement, call action immediately
                step.action();
            }
        } else {
            step.action();
        }
    }

    function nextTutorialStep() {
        currentStep++;
        if (currentStep < tutorialSteps.length) {
            showTutorialStep();
        } else {
            endTutorial();
        }
    }

    function endTutorial() {
        tutorialContainer.style.display = 'none';
        document.getElementById('info').style.display = 'block';
        unhighlightAllElements();
    }

    function highlightElement(element) {
        setTimeout(() => {
            element.classList.add('highlighted-element');
        }, 0);
    }

    function unhighlightAllElements() {
        const highlightedElements = document.querySelectorAll('.highlighted-element');
        highlightedElements.forEach(el => el.classList.remove('highlighted-element'));
    }

    startTutorialButton.addEventListener('click', startTutorial);
    tutorialNext.addEventListener('click', nextTutorialStep);

    const infoPanel = document.getElementById('info');
    const infoCloseButton = document.getElementById('info-close');
    const infoToggleButton = document.getElementById('info-toggle');

    infoCloseButton.addEventListener('click', () => {
        infoPanel.style.display = 'none';
        infoToggleButton.style.display = 'block';
    });

    infoToggleButton.addEventListener('click', () => {
        infoPanel.style.display = 'block';
        infoToggleButton.style.display = 'none';
    });
}


function recreateSeats() {
    if (aircraftGroup.getObjectByName('seatGroup')) {
        aircraftGroup.remove(aircraftGroup.getObjectByName('seatGroup'));
    }
    seatMeshes = [];
    createSeats(aircraftGroup);
}

function updateBookingClassCapacities() {
    let totalRatio = bookingClasses.reduce((acc, rbd) => acc + rbd.capacityRatio, 0);

    let scale = 100.0 / totalRatio;
    bookingClasses.forEach(rbd => rbd.capacityRatio *= scale);

    bookingClasses.forEach(rbd => {
        rbd.capacity = Math.floor(flight.totalSeats * rbd.capacityRatio);
    });

    // Distribute any leftover seats due to flooring
    const unassignedSeats = flight.totalSeats - bookingClasses.reduce((acc, rbd) => acc + rbd.capacity, 0);
    if (unassignedSeats > 0) {
        bookingClasses[bookingClasses.length - 1].capacity += unassignedSeats;
    }
}


function createSeats(aircraftGroup) {
    const seatGroup = new THREE.Group();
    seatGroup.name = 'seatGroup';
    aircraftGroup.add(seatGroup);
    let seatIndex = 0;

    initialSeatAssignments = [];
    bookingClasses.forEach(rbd => {
        for (let i = 0; i < rbd.capacity; i++) {
            initialSeatAssignments.push(rbd);
        }
    });
    initialSeatAssignments.sort(() => Math.random() - 0.5);

    for (let row = 0; row < AIRCRAFT_CONFIG.rows; row++) {
        for (let s = 0; s < AIRCRAFT_CONFIG.seatsPerRow; s++) {
            if (seatIndex >= flight.totalSeats) continue;

            const rbd = initialSeatAssignments[seatIndex];
            const seat = createSeat(rbd.color);

            const zPos = -32 + row * 4.5;
            const xPos = -AIRCRAFT_CONFIG.seatsPerRow * 1.2 - AIRCRAFT_CONFIG.aisleGap + s * 3;
            seat.position.set(xPos + (s >= 3 ? AIRCRAFT_CONFIG.aisleGap * 2 : 0), 10.5, zPos);
            seat.rotation.y = Math.PI;
            
            seat.userData.rbd = rbd;
            seat.userData.isBooked = false;
            seat.userData.originalColor = rbd.color;
            seat.userData.isHighlighted = false;

            seatMeshes.push(seat);
            seatGroup.add(seat);
            seatIndex++;
        }
    }
}

async function loadGLTFModel() {
    const loader = new GLTFLoader();
    aircraftGroup = new THREE.Group();
    scene.add(aircraftGroup);

    try {
        const gltf = await loader.loadAsync('./public/plane.glb');
        const model = gltf.scene;

        model.rotation.y = Math.PI / 2;

        
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        const desiredSize = 240;
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = desiredSize / maxDim;

        model.scale.set(scale, scale, scale);
        
        const newBox = new THREE.Box3().setFromObject(model);
        const newCenter = newBox.getCenter(new THREE.Vector3());
        
        model.position.sub(newCenter);

        model.position.y = 20;
        model.position.z += 15;


        model.traverse((o) => {
            if (o.isMesh) {
                if (o.material.isMeshStandardMaterial) {
                    o.material.transparent = true;
                    o.material.opacity = 0.2;
                    o.material.depthWrite = true;
                }
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });

        aircraftGroup.add(model);

        createCabinFloor(aircraftGroup);

        createSeats(aircraftGroup);
    } catch (error) {
        console.error('An error happened while loading the GLTF model:', error);
        try {
            createSeats(aircraftGroup);
        } catch (e) {
            console.error('Could not create seats without the model:', e);
        }
    }
}

function createSeat(color) {
    const seat = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x343a40 });
    const cushionMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 });

    const backGeom = new THREE.BoxGeometry(1.2, 2.5, 0.2);
    const back = new THREE.Mesh(backGeom, cushionMat);
    back.position.y = 1.25;
    back.position.z = 0.4;
    back.castShadow = true;
    seat.add(back);

    const cushionGeom = new THREE.BoxGeometry(1.2, 0.4, 1.2);
    const cushion = new THREE.Mesh(cushionGeom, cushionMat);
    cushion.position.y = 0.2;
    cushion.position.z = -0.2;
    cushion.castShadow = true;
    seat.add(cushion);

    const baseGeom = new THREE.BoxGeometry(1.2, 0.2, 1.4);
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.z = -0.1;
    seat.add(base);

    seat.userData.cushion = cushion;
    return seat;
    }

    function createCabinFloor(aircraftGroup) {
    // --- KABİN ZEMİNİ ---
    // Zeminin boyutunu (genişlik ve uzunluk) aşağıdaki değişkenleri değiştirerek ayarlayabilirsiniz.
    const floorWidth = 23; // Uçağın genişliğine göre ayarlayın
    const floorLength = 120; // Uçağın uzunluğuna göre ayarlayın

    const floorGeometry = new THREE.PlaneGeometry(floorWidth, floorLength);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.floor(512 * (floorLength / floorWidth)); // En boy oranını koru
    const context = canvas.getContext('2d');

    // Zemin için temel renk
    context.fillStyle = '#303030'; // Daha koyu gri
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Koridor deseni için ızgara çizgileri
    context.strokeStyle = '#555555'; // Çizgiler için daha açık gri
    context.lineWidth = 4; // Görünürlük için daha kalın çizgiler

    // Dikey çizgiler: 3 "koridor" 2 dikey çizgi anlamına gelir
    const numVerticalDivisions = 3; 
    for (let i = 1; i < numVerticalDivisions; i++) {
        context.beginPath();
        context.moveTo(canvas.width / numVerticalDivisions * i, 0);
        context.lineTo(canvas.width / numVerticalDivisions * i, canvas.height);
        context.stroke();
    }

    // Yatay çizgiler: uzunluk boyunca panelleri veya bölümleri simüle etmek için
    const numHorizontalDivisions = Math.floor(floorLength / 5); // Yaklaşık olarak her 5 dünya uzunluğu birimi
    for (let i = 1; i < numHorizontalDivisions; i++) {
        context.beginPath();
        context.moveTo(0, canvas.height / numHorizontalDivisions * i);
        context.lineTo(canvas.width, canvas.height / numHorizontalDivisions * i);
        context.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1); 

    const floorMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    const floor = new THREE.Mesh(floorGeometry, floorMaterial);

    // Zeminin pozisyonunu ve dönüşünü buradan ayarlayabilirsiniz.
    // X ekseninde 90 derece döndürerek zemini yatay hale getiriyoruz.
    floor.rotation.x = -Math.PI / 2; 

    // Zemini kabin içinde doğru yere konumlandırıyoruz. 
    // y: yükseklik, z: ileri/geri konum
    floor.position.set(0, 10, 27); 

    aircraftGroup.add(floor);
    // --- KABİN ZEMİNİ SONU ---
    }

    const presets = {
    'High-Yield': { ratios: [0.25, 0.30, 0.25, 0.15, 0.05], prices: [600, 520, 450, 380, 300] },
    'Balanced': { ratios: [0.10, 0.15, 0.20, 0.25, 0.30], prices: [500, 420, 350, 280, 200] },
    'Low-Cost Focus': { ratios: [0.05, 0.10, 0.15, 0.30, 0.40], prices: [450, 380, 300, 220, 150] },
};

const params = {
    preset: 'Balanced'
};

const highlightState = {
    active: false,
    className: null,
};

function clearAllHighlights() {
    seatMeshes.forEach(seat => {
        if (seat.userData.isHighlighted) {
            seat.userData.cushion.material.emissive.setHex(0x000000);
            seat.userData.isHighlighted = false;
        }
    });
    highlightState.active = false;
    highlightState.className = null;
}

function highlightClass(className) {
    // If the same class is clicked again, turn off highlighting.
    if (highlightState.active && highlightState.className === className) {
        clearAllHighlights();
        return;
    }

    // Clear any previous highlights before applying a new one.
    clearAllHighlights();

    highlightState.active = true;
    highlightState.className = className;

    seatMeshes.forEach(seat => {
        if (seat.userData.rbd.name === className) {
            seat.userData.isHighlighted = true;
        }
    });
}


function applyPreset(presetName) {
    const preset = presets[presetName];
    if (!preset) return;

    bookingClasses.forEach((rbd, i) => {
        rbd.capacityRatio = preset.ratios[i];
        rbd.price = preset.prices[i];
    });

    updateBookingClassCapacities();
    resetSimulation(true);
}

function setupGUI() {
    if (gui) gui.destroy();
    gui = new GUI({ title: 'RM Simulation', width: 300 });

    // Status Folder
    const statusFolder = gui.addFolder('📈 Flight Status');
    statusFolder.add(guiStats, 'Load Factor').listen();
    statusFolder.add(guiStats, 'Revenue').listen();
    statusFolder.open();

    // Simulation Controls Folder
    const simFolder = gui.addFolder('⚙️ Simulation Controls');
    simFolder.add(params, 'preset', Object.keys(presets)).name('Scenario Preset').onChange(applyPreset);
    simFolder.add(simControls, 'numToBook', 1, 50, 1).name('Passengers to Book');
    simFolder.add(flight, 'overbooking', 0, 20, 1).name('Overbooking (%)');
    simFolder.add(simControls, 'run').name('▶️ Run Booking');
    simFolder.add(guiStats, 'Reset Simulation').name('🔁 Reset Simulation');
    simFolder.open();

    // Fine-Tuning Folder
    const fineTuneFolder = gui.addFolder('Fine-Tune Strategy');
    bookingClasses.forEach(rbd => {
        const folder = fineTuneFolder.addFolder(rbd.name);
        const rbdParams = {
            color: rbd.color,
            highlight: () => highlightClass(rbd.name)
        };
        const colorController = folder.addColor(rbdParams, 'color').name(rbd.name.substring(0, rbd.name.indexOf('(') > 0 ? rbd.name.indexOf('(') - 1 : rbd.name.length));

        folder.add(rbd, 'price', 100, 1000, 10).name('Price (€)').onChange(() => resetSimulation(false));
        folder.add(rbd, 'capacityRatio', 0, 100, 10).name('Capacity Ratio').onChange(() => {
            updateBookingClassCapacities();
            resetSimulation(true);
        });
        colorController.disable();
        folder.add(rbdParams, 'highlight').name('Highlight');
        
    });
    fineTuneFolder.close();

    // Global Actions
    // gui.add(guiStats, 'Reset Simulation').name('🔁 Reset Simulation');
}



function simulatePassengerBooking() {
    if (flight.bookedSeats >= flight.capacity) {
        console.log("Booking failed: At or over capacity.");
        const notification = document.getElementById('full-flight-notification');
        if (notification) {
            notification.innerText = 'Kapasite Dolu! Daha fazla bilet satılamaz.';
            notification.style.display = 'block';
        }
        return;
    }

    const availableClasses = bookingClasses.filter(rbd => rbd.booked < rbd.capacity);
    if (availableClasses.length === 0) {
        // Overbooking phase: only book if there's overbooking capacity left
        if (flight.bookedSeats < flight.capacity) {
            const cheapestClass = bookingClasses.slice().sort((a, b) => a.price - b.price)[0];
            console.log("Overbooking into cheapest class:", cheapestClass.name);
            bookSeat(cheapestClass);
        }
        return;
    }

    // Passenger profiles
    // New logic: Price-sensitive weighted selection
    const totalDesirability = availableClasses.reduce((acc, rbd) => {
        // Inverse relationship with price. A lower price is more desirable.
        // Adding 1 to avoid division by zero if a price is 0.
        rbd.desirability = 1000 / (rbd.price + 1);
        return acc + rbd.desirability;
    }, 0);

    const randomPoint = Math.random() * totalDesirability;
    let currentSum = 0;
    let targetClass = null;

    for (const rbd of availableClasses) {
        currentSum += rbd.desirability;
        if (randomPoint <= currentSum) {
            targetClass = rbd;
            break;
        }
    }

    // Fallback in case of rounding errors
    if (!targetClass && availableClasses.length > 0) {
        targetClass = availableClasses[0];
    }

    if(targetClass) {
        bookSeat(targetClass);
    }
}


function bookSeat(rbd) {
    rbd.booked++;
    flight.bookedSeats++;
    flight.revenue += rbd.price;

    // Önce doğru sınıfta boş bir koltuk bulmaya çalışın.
    let seatToBook = seatMeshes.find(s => !s.userData.isBooked && s.userData.rbd.name === rbd.name);

    // Eğer belirli bir sınıfta koltuk bulunamazsa (özellikle overbooking sırasında),
    // mevcut HERHANGİ bir boş koltuğu bulun. Bu, uçağın görsel olarak dolmasını sağlar.
    if (!seatToBook) {
        seatToBook = seatMeshes.find(s => !s.userData.isBooked);
    }

    if (seatToBook) {
        // Fiziksel koltuğun orijinal rengini koyulaştırarak dolu olduğunu gösterin.
        const bookedColor = new THREE.Color(seatToBook.userData.originalColor).multiplyScalar(0.4);
        seatToBook.userData.cushion.material.color.set(bookedColor);
        seatToBook.userData.cushion.material.emissive.setHex(0x000000); // Clear any highlight/emissive
        seatToBook.userData.isBooked = true;
    } else {
         // Bu durum artık sadece uçak fiziksel olarak doluyken ve overbooking nedeniyle bilet satmaya devam ettiğimizde gerçekleşir.
         console.log(`No physical seat for class ${rbd.name}, but ticket sold (overbooking).`);
    }

    updateGUI();

    const notification = document.getElementById('full-flight-notification');
    if (flight.bookedSeats === flight.totalSeats) {
        if (notification) {
            notification.innerText = 'Tüm Koltuklar Dolu! (Overbooking yapılıyor)';
            notification.style.display = 'block';
        }
    }
}


function updateGUI() {
    if (!gui) return;
    
    const loadFactor = (flight.bookedSeats / flight.totalSeats) * 100;
    guiStats['Load Factor'] = `${loadFactor.toFixed(2)}%`;
    guiStats['Revenue'] = `€${flight.revenue.toLocaleString()}`;

    // This is a robust way to update lil-gui
    gui.controllers.forEach(c => c.updateDisplay());
    gui.folders.forEach(f => {
        f.controllers.forEach(c => c.updateDisplay());
        f.folders.forEach(ff => ff.controllers.forEach(c => c.updateDisplay()));
    });
}

function resetSimulation(recreate = true) {
    flight.bookedSeats = 0;
    flight.revenue = 0;
    bookingClasses.forEach(rbd => rbd.booked = 0);
    clearAllHighlights(); 

    const notification = document.getElementById('full-flight-notification');
    if (notification) {
        notification.style.display = 'none';
    }

    if (recreate) {
        recreateSeats();
        setupGUI(); // Rebuild GUI to update controllers
    } else {
        seatMeshes.forEach(seat => {
            seat.userData.isBooked = false;
            seat.userData.cushion.material.color.set(seat.userData.originalColor);
        });
    }

    updateGUI();
}

const aircraftOpacityLevels = [
    0.2, // View 0: Wide Shot - Opaque
    1.0, // View 1: Cabin View - Very transparent
    1.0, // View 2: Cockpit View - Very transparent
    0.1  // View 3: Top-Down View - Very transparent
];

function tweenCamera(viewIndex) {
    const view = cameraViews[viewIndex];
    if (!view) return;

    cameraAnimation.startPos.copy(camera.position);
    cameraAnimation.endPos.copy(view.position);
    cameraAnimation.startTarget.copy(controls.target);
    cameraAnimation.endTarget.copy(view.target);
    cameraAnimation.alpha = 0;
    cameraAnimation.active = true;
    controls.enabled = false; // Disable controls during animation

    // Adjust aircraft opacity based on viewIndex
    if (aircraftGroup && aircraftGroup.children.length > 0) {
        const model = aircraftGroup.children[0]; // Assuming the GLTF model is the first child
        if (model) {
            const targetOpacity = aircraftOpacityLevels[viewIndex];
            model.traverse((o) => {
                if (o.isMesh && o.material.isMeshStandardMaterial) {
                    o.material.opacity = targetOpacity;
                    o.material.needsUpdate = true; // Important for opacity changes to take effect
                }
            });
        }
    }
}


function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    mouseX = event.clientX;
    mouseY = event.clientY;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function checkIntersection() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(seatMeshes, true);

    if (intersected) {
        intersected.material.emissive.setHex(0x000000);
        intersected = null;
    }
    tooltip.style.display = 'none';

    if (intersects.length > 0) {
        let seatGroup = intersects[0].object;
        while(seatGroup.parent && !seatGroup.userData.rbd) {
            seatGroup = seatGroup.parent;
        }

        if (seatGroup.userData.rbd && !seatGroup.userData.isBooked) {
            intersected = seatGroup.userData.cushion;
            intersected.material.emissive.setHex(0x444444);

            tooltip.style.display = 'block';
            tooltip.style.left = mouseX + 10 + 'px';
            tooltip.style.top = mouseY + 10 + 'px';
            const rbd = seatGroup.userData.rbd;
            tooltip.innerHTML = `<strong>${rbd.name}</strong><br>Price: €${rbd.price}<br>Status: Available`;
        } else if (seatGroup.userData.isBooked) {
            tooltip.style.display = 'block';
            tooltip.style.left = mouseX + 10 + 'px';
            tooltip.style.top = mouseY + 10 + 'px';
            const rbd = seatGroup.userData.rbd;
            tooltip.innerHTML = `<strong>${rbd.name}</strong><br>Status: Booked`;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (cameraAnimation.active) {
        cameraAnimation.alpha = Math.min(1, cameraAnimation.alpha + delta / cameraAnimation.duration); // Ensure alpha doesn't exceed 1

        // Ease-in-out quint function
        const easedAlpha = cameraAnimation.alpha < 0.5
            ? 16 * Math.pow(cameraAnimation.alpha, 5)
            : 1 - Math.pow(-2 * cameraAnimation.alpha + 2, 5) / 2;

        // Interpolate position and target
        camera.position.lerpVectors(cameraAnimation.startPos, cameraAnimation.endPos, easedAlpha);
        controls.target.lerpVectors(cameraAnimation.startTarget, cameraAnimation.endTarget, easedAlpha);

        // Add a cinematic arc to the camera movement
        const arcHeight = Math.sin(cameraAnimation.alpha * Math.PI) * 25; // Peak height of the arc
        camera.position.y += arcHeight;


        if (cameraAnimation.alpha >= 1) {
            cameraAnimation.active = false;
            cameraAnimation.alpha = 0;
            // Snap to final position and target to ensure accuracy
            camera.position.copy(cameraAnimation.endPos);
            controls.target.copy(cameraAnimation.endTarget);
            controls.enabled = true; // Re-enable controls
        }
    }
    
    if (highlightState.active) {
        const blinkValue = (Math.sin(clock.getElapsedTime() * 5) + 1) / 2; // 0 ile 1 arasında salınım
        seatMeshes.forEach(seat => {
            if (seat.userData.isHighlighted) {
                // emissive rengini siyah ile vurgu rengi arasında enterpole et
                seat.userData.cushion.material.emissive.copy(baseEmissive).lerp(highlightColor, blinkValue);
            }
        });
    }

    if(!cameraAnimation.active) {
        controls.update();
    }
    
    checkIntersection();
    renderer.render(scene, camera);
}

init();
animate();