/* ===================================================================
           1. GAME ENGINE CONSTANTS & GLOBALS
           =================================================================== */
        const CANVAS_WIDTH = 800;
        const CANVAS_HEIGHT = 450;
        const TILE_SIZE = 20; // 20px per tile block
        const WORLD_TILES_X = 180; // 3600px wide
        const WORLD_TILES_Y = 30;  // 600px tall
        const WORLD_WIDTH = WORLD_TILES_X * TILE_SIZE; // 3600px
        const WORLD_HEIGHT = WORLD_TILES_Y * TILE_SIZE; // 600px

        // Canvas & Context Setup
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const minimapCanvas = document.getElementById('minimap');
        const miniCtx = minimapCanvas.getContext('2d');

        // Disable smoothing for sharp pixel rendering
        ctx.imageSmoothingEnabled = false;
        miniCtx.imageSmoothingEnabled = false;

        /* Web Audio API Synthesizer Sound Generator */
        class RetroAudio {
            constructor() {
                this.ctx = null;
            }
            init() {
                if (!this.ctx) {
                    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                }
            }
            playTone(freq, type, duration, vol = 0.1) {
                if (!this.ctx) return;
                try {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = type;
                    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start();
                    osc.stop(this.ctx.currentTime + duration);
                } catch(e) {}
            }
            playJump() {
                if (!this.ctx) return;
                try {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(450, this.ctx.currentTime + 0.15);
                    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
                    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start();
                    osc.stop(this.ctx.currentTime + 0.15);
                } catch(e) {}
            }
            playBite() {
                this.playTone(120, 'sawtooth', 0.12, 0.15);
            }
            playDna() {
                this.playTone(600, 'sine', 0.08, 0.1);
                setTimeout(() => this.playTone(900, 'sine', 0.12, 0.1), 60);
            }
            playExplosion() {
                this.playTone(60, 'sawtooth', 0.6, 0.25);
            }
        }
        const audio = new RetroAudio();

        // Evolution & Upgrade System State
        const upgrades = {
            bite: { lvl: 0, cost: 20 },
            speed: { lvl: 0, cost: 15 },
            jump: { lvl: 0, cost: 15 },
            time: { lvl: 0, cost: 25 }
        };

        let generation = 1;
        let totalDna = 0;
        let currentRunDna = 0;
        let timerMax = 30.0;
        let timerRemaining = 30.0;
        let gameState = 'START'; // 'START', 'PLAYING', 'EXTINCTION', 'EVO_SHOP'
        let lastTime = 0;

        // Camera object with Lerp / Smooth Following
        const camera = {
            x: 0,
            y: 0,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            update(targetX, targetY) {
                // Smooth camera follow (lerp factor 0.1)
                const targetCamX = targetX - this.width / 2;
                const targetCamY = targetY - this.height / 2;
                
                this.x += (targetCamX - this.x) * 0.1;
                this.y += (targetCamY - this.y) * 0.1;

                // Clamp to world boundaries
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.width, this.x));
                this.y = Math.max(0, Math.min(WORLD_HEIGHT - this.height, this.y));
            }
        };

        // Inputs State
        const keys = {
            left: false,
            right: false,
            jump: false,
            bite: false
        };

        // Tilemap Enum Types
        const TILE = {
            AIR: 0,
            GRASS: 1,
            DIRT: 2,
            STONE: 3,
            CAVE_AIR: 4
        };

        let worldMap = []; // 2D grid [y][x]
        let floraList = []; // Prehistoric trees/ferns
        let dnaPickups = []; // DNA fossils scatter
        let preyList = [];  // Roaming prey creatures
        let particleList = []; // Visual particle effects

        // Sine-wave noise helper for organic ground terrain
        function generateWorld() {
            worldMap = Array(WORLD_TILES_Y).fill(0).map(() => Array(WORLD_TILES_X).fill(TILE.AIR));
            floraList = [];
            dnaPickups = [];
            preyList = [];

            // Heightmap terrain generation
            for (let x = 0; x < WORLD_TILES_X; x++) {
                // Combine sine waves for natural hill curves
                const baseHeight = 16; 
                const hillOffset = Math.floor(
                    Math.sin(x * 0.08) * 3 + 
                    Math.sin(x * 0.03) * 5 + 
                    Math.cos(x * 0.15) * 1.5
                );
                const surfaceY = Math.max(8, Math.min(WORLD_TILES_Y - 5, baseHeight + hillOffset));

                // Fill downward from surface
                for (let y = surfaceY; y < WORLD_TILES_Y; y++) {
                    if (y === surfaceY) {
                        worldMap[y][x] = TILE.GRASS;
                        // Chance to place giant fern/cycad on grass
                        if (x % 5 === 0 || Math.random() < 0.2) {
                            floraList.push({
                                x: x * TILE_SIZE,
                                y: (y - 1) * TILE_SIZE,
                                type: Math.random() < 0.5 ? 'FERN' : 'CYCAD'
                            });
                        }
                    } else if (y < surfaceY + 5) {
                        worldMap[y][x] = TILE.DIRT;
                    } else {
                        worldMap[y][x] = TILE.STONE;
                    }
                }
            }

            // Carve underground caverns / caves
            for (let x = 10; x < WORLD_TILES_X - 10; x++) {
                for (let y = 18; y < WORLD_TILES_Y - 2; y++) {
                    const noise = Math.sin(x * 0.2) * Math.cos(y * 0.3);
                    if (noise > 0.25) {
                        worldMap[y][x] = TILE.CAVE_AIR;
                    }
                }
            }

            // Spawn DNA Fossils across surface and underground
            for (let i = 0; i < 35; i++) {
                const rx = Math.floor(Math.random() * (WORLD_TILES_X - 10)) + 5;
                let ry = 0;
                // Find ground level at x
                for (let y = 0; y < WORLD_TILES_Y; y++) {
                    if (worldMap[y][rx] !== TILE.AIR) {
                        ry = y - 1;
                        break;
                    }
                }
                // Randomly put some deep in caves
                if (Math.random() < 0.4) {
                    ry = Math.floor(Math.random() * 8) + 18;
                }
                dnaPickups.push({
                    x: rx * TILE_SIZE + 4,
                    y: ry * TILE_SIZE + 4,
                    width: 12,
                    height: 12,
                    collected: false,
                    val: Math.floor(Math.random() * 5) + 5
                });
            }

            // Spawn Roaming Prey Entities
            for (let i = 0; i < 16; i++) {
                const px = Math.floor(Math.random() * (WORLD_TILES_X - 20) + 10) * TILE_SIZE;
                preyList.push(new Prey(px, 100, Math.random() < 0.5 ? 'LIZARD' : 'MAMMOTH_RAT'));
            }
        }

        /* ===================================================================
           2. UTAHRAPTOR PLAYER CLASS
           =================================================================== */
        class Utahraptor {
            constructor() {
                this.width = 36;
                this.height = 24;
                this.x = 200;
                this.y = 100;
                this.vx = 0;
                this.vy = 0;
                this.grounded = false;
                this.facing = 1; // 1 = right, -1 = left
                this.animFrame = 0;
                this.animTimer = 0;
                
                // Stats
                this.maxHp = 100;
                this.hp = 100;
                this.isAttacking = false;
                this.attackTimer = 0;
                this.attackCooldown = 0;

                // Dynamic base attributes boosted by upgrades
                this.moveSpeed = 3.8 + (upgrades.speed.lvl * 0.6);
                this.jumpPower = -8.8 - (upgrades.jump.lvl * 0.9);
                this.biteDamage = 35 + (upgrades.bite.lvl * 15);
            }

            reset() {
                this.x = 200;
                this.y = 100;
                this.vx = 0;
                this.vy = 0;
                this.hp = this.maxHp;
                this.moveSpeed = 3.8 + (upgrades.speed.lvl * 0.6);
                this.jumpPower = -8.8 - (upgrades.jump.lvl * 0.9);
                this.biteDamage = 35 + (upgrades.bite.lvl * 15);
            }

            update(dt) {
                // Hunger decay over time
                this.hp = Math.max(0, this.hp - dt * 1.2);

                // Horizontal movement
                if (keys.left) {
                    this.vx = -this.moveSpeed;
                    this.facing = -1;
                } else if (keys.right) {
                    this.vx = this.moveSpeed;
                    this.facing = 1;
                } else {
                    this.vx *= 0.7; // Friction
                }

                // Jump
                if (keys.jump && this.grounded) {
                    this.vy = this.jumpPower;
                    this.grounded = false;
                    audio.playJump();
                }

                // Gravity
                this.vy += 0.45;

                // Attack logic
                if (this.attackCooldown > 0) this.attackCooldown -= dt;
                if (keys.bite && this.attackCooldown <= 0) {
                    this.isAttacking = true;
                    this.attackTimer = 0.22; // 220ms bite animation duration
                    this.attackCooldown = 0.4;
                    audio.playBite();
                    this.performBiteAttack();
                }

                if (this.isAttacking) {
                    this.attackTimer -= dt;
                    if (this.attackTimer <= 0) this.isAttacking = false;
                }

                // Apply velocity and collide with tilemap
                this.moveAndCollide();

                // Animation step timer
                if (Math.abs(this.vx) > 0.5) {
                    this.animTimer += dt * 12;
                    this.animFrame = Math.floor(this.animTimer) % 4;
                } else {
                    this.animFrame = 0;
                }
            }

            performBiteAttack() {
                // Attack Hitbox in front of raptor jaw
                const biteX = this.facing === 1 ? this.x + this.width : this.x - 20;
                const biteY = this.y;
                const biteW = 24;
                const biteH = this.height;

                // Spawn bite spark particles
                for (let i = 0; i < 6; i++) {
                    particleList.push(new Particle(
                        biteX + biteW / 2, 
                        biteY + biteH / 2, 
                        (Math.random() - 0.5) * 4, 
                        (Math.random() - 0.5) * 4, 
                        '#38bdf8', 
                        12
                    ));
                }

                // Check collision with prey
                preyList.forEach(prey => {
                    if (prey.alive &&
                        biteX < prey.x + prey.width &&
                        biteX + biteW > prey.x &&
                        biteY < prey.y + prey.height &&
                        biteY + biteH > prey.y) {
                        
                        prey.takeDamage(this.biteDamage);
                        if (!prey.alive) {
                            // Eat prey: restore hp and award extra DNA
                            const hpGain = prey.type === 'LIZARD' ? 20 : 35;
                            const dnaGain = (prey.type === 'LIZARD' ? 8 : 15) * (1 + upgrades.bite.lvl * 0.25);
                            this.hp = Math.min(this.maxHp, this.hp + hpGain);
                            currentRunDna += Math.floor(dnaGain);
                            totalDna += Math.floor(dnaGain);

                            // Blood/meat splash particles
                            for (let p = 0; p < 12; p++) {
                                particleList.push(new Particle(
                                    prey.x + prey.width / 2, 
                                    prey.y + prey.height / 2, 
                                    (Math.random() - 0.5) * 6, 
                                    (Math.random() - 0.5) * 6, 
                                    '#ef4444', 
                                    20
                                ));
                            }
                            showBanner(`Prey Consumed! +${hpGain} Hunger | +${Math.floor(dnaGain)} DNA`);
                        }
                    }
                });
            }

            moveAndCollide() {
                // X Axis Movement
                this.x += this.vx;
                let bounds = this.getTileBounds();
                for (let y = bounds.top; y <= bounds.bottom; y++) {
                    for (let x = bounds.left; x <= bounds.right; x++) {
                        if (isSolidTile(x, y)) {
                            if (this.vx > 0) this.x = x * TILE_SIZE - this.width;
                            else if (this.vx < 0) this.x = (x + 1) * TILE_SIZE;
                            this.vx = 0;
                        }
                    }
                }

                // Y Axis Movement
                this.y += this.vy;
                this.grounded = false;
                bounds = this.getTileBounds();
                for (let y = bounds.top; y <= bounds.bottom; y++) {
                    for (let x = bounds.left; x <= bounds.right; x++) {
                        if (isSolidTile(x, y)) {
                            if (this.vy > 0) {
                                this.y = y * TILE_SIZE - this.height;
                                this.vy = 0;
                                this.grounded = true;
                            } else if (this.vy < 0) {
                                this.y = (y + 1) * TILE_SIZE;
                                this.vy = 0;
                            }
                        }
                    }
                }

                // World bound clamping
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.width, this.x));
                if (this.y > WORLD_HEIGHT) {
                    this.hp = 0; // Fell off world
                }
            }

            getTileBounds() {
                return {
                    left: Math.floor(this.x / TILE_SIZE),
                    right: Math.floor((this.x + this.width - 1) / TILE_SIZE),
                    top: Math.floor(this.y / TILE_SIZE),
                    bottom: Math.floor((this.y + this.height - 1) / TILE_SIZE)
                };
            }

            /* Custom Procedural Pixel Renderer matching user image sprite style! */
            draw(ctx, cam) {
                const screenX = this.x - cam.x;
                const screenY = this.y - cam.y;

                ctx.save();
                ctx.translate(screenX + this.width / 2, screenY + this.height / 2);
                if (this.facing === -1) ctx.scale(-1, 1);

                // Colors derived from sprite image_bf6f37.png:
                const cBody = '#3b3355';      // Dark Slate Purple
                const cBelly = '#d4a237';     // Gold/Yellow underbelly
                const cFeather = '#1c73cf';   // Deep Blue Feathers
                const cCyan = '#2ca2e6';      // Bright Cyan Accent
                const cClaw = '#f59e0b';      // Yellow claws

                // Leg running animation offsets
                const legOffset = Math.sin(this.animTimer * 1.2) * 4;

                // 1. Feathered Tail (Behind body)
                ctx.fillStyle = cFeather;
                ctx.beginPath();
                ctx.moveTo(-10, -2);
                ctx.lineTo(-28, -6 + Math.sin(this.animTimer) * 2);
                ctx.lineTo(-26, 2);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = cCyan;
                ctx.fillRect(-26, -4, 12, 4);

                // 2. Back Legs
                ctx.fillStyle = '#2a2340';
                ctx.fillRect(-6 + legOffset, 6, 5, 10);
                ctx.fillStyle = cClaw;
                ctx.fillRect(-4 + legOffset, 14, 4, 3); // Raptor sickle claw

                // 3. Main Torso Body
                ctx.fillStyle = cBody;
                ctx.fillRect(-12, -8, 22, 14);

                // Gold Underbelly
                ctx.fillStyle = cBelly;
                ctx.fillRect(-4, 0, 12, 5);

                // 4. Head & Neck
                ctx.fillStyle = cBody;
                ctx.fillRect(4, -14, 12, 12); // Neck/head block
                ctx.fillRect(10, -12, 10, 8);  // Snout

                // Eye
                ctx.fillStyle = '#fef08a';
                ctx.fillRect(10, -11, 2, 2);

                // Jaw Biting Animation
                if (this.isAttacking) {
                    ctx.fillStyle = '#ef4444'; // Red inside mouth
                    ctx.fillRect(12, -6, 8, 4);
                    ctx.fillStyle = cBody;
                    ctx.fillRect(10, -2, 10, 4); // Lowered jaw
                }

                // 5. Feathered Wings/Arms
                ctx.fillStyle = cCyan;
                ctx.fillRect(0, -2, 10, 6);
                ctx.fillStyle = cFeather;
                ctx.fillRect(4, 2, 8, 4);
                ctx.fillStyle = cClaw;
                ctx.fillRect(10, 2, 3, 3);

                // 6. Front Leg
                ctx.fillStyle = cBody;
                ctx.fillRect(-2 - legOffset, 6, 5, 10);
                ctx.fillStyle = cClaw;
                ctx.fillRect(0 - legOffset, 14, 5, 3);

                ctx.restore();
            }
        }

        /* ===================================================================
           3. PREY & ENTITY CLASSES
           =================================================================== */
        class Prey {
            constructor(x, y, type) {
                this.x = x;
                this.y = y;
                this.type = type; // 'LIZARD' or 'MAMMOTH_RAT'
                this.width = type === 'LIZARD' ? 18 : 22;
                this.height = type === 'LIZARD' ? 10 : 14;
                this.vx = (Math.random() - 0.5) * 2;
                this.vy = 0;
                this.hp = type === 'LIZARD' ? 20 : 45;
                this.alive = true;
                this.facing = 1;
                this.changeDirTimer = 0;
            }

            takeDamage(dmg) {
                this.hp -= dmg;
                if (this.hp <= 0) this.alive = false;
            }

            update(dt, playerX) {
                if (!this.alive) return;

                // Fleeing AI: run away from player if near
                const distToPlayer = playerX - this.x;
                if (Math.abs(distToPlayer) < 140) {
                    this.vx = distToPlayer > 0 ? -2.2 : 2.2;
                } else {
                    // Random wander
                    this.changeDirTimer -= dt;
                    if (this.changeDirTimer <= 0) {
                        this.vx = (Math.random() - 0.5) * 1.5;
                        this.changeDirTimer = Math.random() * 3 + 1;
                    }
                }

                this.facing = this.vx >= 0 ? 1 : -1;
                this.vy += 0.4; // Gravity

                // Move X & Tile Collide
                this.x += this.vx;
                if (isSolidTile(Math.floor((this.x + (this.vx > 0 ? this.width : 0)) / TILE_SIZE), Math.floor(this.y / TILE_SIZE))) {
                    this.x -= this.vx;
                    this.vx = -this.vx;
                }

                // Move Y & Tile Collide
                this.y += this.vy;
                const tileY = Math.floor((this.y + this.height) / TILE_SIZE);
                const tileX = Math.floor((this.x + this.width / 2) / TILE_SIZE);
                if (isSolidTile(tileX, tileY)) {
                    this.y = (tileY * TILE_SIZE) - this.height;
                    this.vy = 0;
                }
            }

            draw(ctx, cam) {
                if (!this.alive) return;
                const screenX = this.x - cam.x;
                const screenY = this.y - cam.y;

                ctx.save();
                ctx.translate(screenX + this.width / 2, screenY + this.height / 2);
                if (this.facing === -1) ctx.scale(-1, 1);

                if (this.type === 'LIZARD') {
                    // Fast Green Lizard
                    ctx.fillStyle = '#22c55e';
                    ctx.fillRect(-8, -3, 14, 6);
                    ctx.fillStyle = '#15803d';
                    ctx.fillRect(4, -4, 5, 4); // Head
                    ctx.fillRect(-12, -1, 5, 2); // Tail
                } else {
                    // Brown Prehistoric Rodent/Mammal
                    ctx.fillStyle = '#a16207';
                    ctx.fillRect(-9, -5, 16, 10);
                    ctx.fillStyle = '#78350f';
                    ctx.fillRect(5, -6, 6, 6); // Head
                    ctx.fillStyle = '#fef08a';
                    ctx.fillRect(7, -5, 2, 2); // Eye
                }

                ctx.restore();
            }
        }

        /* Particle Visual Effect System */
        class Particle {
            constructor(x, y, vx, vy, color, life) {
                this.x = x;
                this.y = y;
                this.vx = vx;
                this.vy = vy;
                this.color = color;
                this.life = life;
                this.maxLife = life;
            }
            update() {
                this.x += this.vx;
                this.y += this.vy;
                this.life--;
            }
            draw(ctx, cam) {
                ctx.fillStyle = this.color;
                ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
                ctx.fillRect(this.x - cam.x, this.y - cam.y, 3, 3);
                ctx.globalAlpha = 1.0;
            }
        }

        // Helper tile lookup
        function isSolidTile(tx, ty) {
            if (tx < 0 || tx >= WORLD_TILES_X || ty < 0 || ty >= WORLD_TILES_Y) return true;
            const tile = worldMap[ty][tx];
            return tile === TILE.GRASS || tile === TILE.DIRT || tile === TILE.STONE;
        }

        /* ===================================================================
           4. RENDERERS & ENVIRONMENT
           =================================================================== */
        function drawParallaxBackground(ctx, cam) {
            // Sky gradient (changes to blood red when meteor strikes near)
            const dangerRatio = 1 - (timerRemaining / timerMax);
            const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
            
            if (dangerRatio > 0.7) {
                skyGrad.addColorStop(0, '#450a0a');
                skyGrad.addColorStop(1, '#9a3412');
            } else {
                skyGrad.addColorStop(0, '#0f172a');
                skyGrad.addColorStop(0.6, '#1e293b');
                skyGrad.addColorStop(1, '#334155');
            }
            ctx.fillStyle = skyGrad;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            // Layer 1: Distant Volcanic Mountains (Parallax Speed 0.1)
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.moveTo(0, CANVAS_HEIGHT);
            for (let x = 0; x <= CANVAS_WIDTH; x += 40) {
                const worldX = x + cam.x * 0.1;
                const mountainH = Math.sin(worldX * 0.005) * 80 + 180;
                ctx.lineTo(x, CANVAS_HEIGHT - mountainH);
            }
            ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
            ctx.closePath();
            ctx.fill();

            // Volcano Smoke plumes in background
            if (dangerRatio > 0.5) {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
                ctx.beginPath();
                ctx.arc(200 - cam.x * 0.1, 100, 40 + Math.sin(Date.now() * 0.003) * 10, 0, Math.PI * 2);
                ctx.arc(600 - cam.x * 0.1, 120, 50 + Math.cos(Date.now() * 0.003) * 10, 0, Math.PI * 2);
                ctx.fill();
            }

            // Layer 2: Midground Fern Forests (Parallax Speed 0.35)
            ctx.fillStyle = '#064e3b';
            ctx.beginPath();
            ctx.moveTo(0, CANVAS_HEIGHT);
            for (let x = 0; x <= CANVAS_WIDTH; x += 30) {
                const worldX = x + cam.x * 0.35;
                const forestH = Math.sin(worldX * 0.02) * 35 + 80;
                ctx.lineTo(x, CANVAS_HEIGHT - forestH);
            }
            ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
            ctx.closePath();
            ctx.fill();
        }

        // Draw Terraria Tile Grid
        function drawWorldTiles(ctx, cam) {
            const startX = Math.max(0, Math.floor(cam.x / TILE_SIZE));
            const endX = Math.min(WORLD_TILES_X - 1, Math.ceil((cam.x + CANVAS_WIDTH) / TILE_SIZE));
            const startY = Math.max(0, Math.floor(cam.y / TILE_SIZE));
            const endY = Math.min(WORLD_TILES_Y - 1, Math.ceil((cam.y + CANVAS_HEIGHT) / TILE_SIZE));

            for (let y = startY; y <= endY; y++) {
                for (let x = startX; x <= endX; x++) {
                    const tile = worldMap[y][x];
                    const screenX = x * TILE_SIZE - cam.x;
                    const screenY = y * TILE_SIZE - cam.y;

                    if (tile === TILE.GRASS) {
                        ctx.fillStyle = '#15803d'; // Green Grass Top
                        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                        ctx.fillStyle = '#22c55e'; // Bright Grass Fringe
                        ctx.fillRect(screenX, screenY, TILE_SIZE, 4);
                    } else if (tile === TILE.DIRT) {
                        ctx.fillStyle = '#78350f'; // Dirt block
                        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                        // Specks
                        ctx.fillStyle = '#451a03';
                        ctx.fillRect(screenX + 4, screenY + 4, 3, 3);
                    } else if (tile === TILE.STONE) {
                        ctx.fillStyle = '#334155'; // Stone block
                        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                        ctx.fillStyle = '#1e293b';
                        ctx.fillRect(screenX + 2, screenY + 2, 8, 8);
                    } else if (tile === TILE.CAVE_AIR) {
                        ctx.fillStyle = '#090d16'; // Underground dark cave background
                        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                    }
                }
            }

            // Render Prehistoric Plants (Cycads/Ferntrees)
            floraList.forEach(plant => {
                if (plant.x > cam.x - 40 && plant.x < cam.x + CANVAS_WIDTH + 40) {
                    const px = plant.x - cam.x;
                    const py = plant.y - cam.y;
                    ctx.fillStyle = '#047857';
                    ctx.fillRect(px + 8, py - 12, 4, 20); // Trunk
                    ctx.fillStyle = '#10b981';
                    ctx.beginPath();
                    ctx.arc(px + 10, py - 14, 12, 0, Math.PI * 2); // Foliage crown
                    ctx.fill();
                }
            });

            // Render DNA Fossils
            dnaPickups.forEach(dna => {
                if (!dna.collected && dna.x > cam.x - 20 && dna.x < cam.x + CANVAS_WIDTH + 20) {
                    const dx = dna.x - cam.x;
                    const dy = dna.y - cam.y;
                    ctx.fillStyle = '#38bdf8';
                    ctx.fillRect(dx + 3, dy, 6, 12);
                    ctx.fillRect(dx, dy + 3, 12, 6);
                    ctx.fillStyle = '#e0f2fe';
                    ctx.fillRect(dx + 4, dy + 4, 4, 4);
                }
            });
        }

        // Minimap Render Function
        function drawMinimap(player) {
            miniCtx.fillStyle = '#020617';
            miniCtx.fillRect(0, 0, 180, 30);

            // Draw landscape dots
            const scaleX = 180 / WORLD_TILES_X;
            const scaleY = 30 / WORLD_TILES_Y;

            for (let x = 0; x < WORLD_TILES_X; x += 2) {
                for (let y = 0; y < WORLD_TILES_Y; y += 2) {
                    const tile = worldMap[y][x];
                    if (tile !== TILE.AIR && tile !== TILE.CAVE_AIR) {
                        miniCtx.fillStyle = tile === TILE.GRASS ? '#22c55e' : '#475569';
                        miniCtx.fillRect(x * scaleX, y * scaleY, 2, 2);
                    }
                }
            }

            // DNA dots (cyan)
            miniCtx.fillStyle = '#38bdf8';
            dnaPickups.forEach(dna => {
                if (!dna.collected) {
                    miniCtx.fillRect((dna.x / TILE_SIZE) * scaleX, (dna.y / TILE_SIZE) * scaleY, 2, 2);
                }
            });

            // Player dot (glowing yellow)
            miniCtx.fillStyle = '#f59e0b';
            miniCtx.fillRect((player.x / TILE_SIZE) * scaleX, (player.y / TILE_SIZE) * scaleY, 3, 3);
        }

        /* Display Floating Banner */
        let bannerTimeout;
        function showBanner(text) {
            const banner = document.getElementById('game-banner');
            const bannerText = document.getElementById('game-banner-text');
            bannerText.innerText = text;
            banner.classList.remove('opacity-0', '-translate-y-4');
            banner.classList.add('opacity-100', 'translate-y-0');
            
            clearTimeout(bannerTimeout);
            bannerTimeout = setTimeout(() => {
                banner.classList.remove('opacity-100', 'translate-y-0');
                banner.classList.add('opacity-0', '-translate-y-4');
            }, 2500);
        }

        /* ===================================================================
           5. GAME CONTROLLER & MAIN LOOP
           =================================================================== */
        const player = new Utahraptor();

        function startNewRun() {
            timerMax = 30.0 + (upgrades.time.lvl * 5.0);
            timerRemaining = timerMax;
            currentRunDna = 0;
            generateWorld();
            player.reset();
            gameState = 'PLAYING';

            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('evolution-modal').classList.add('hidden');
            document.getElementById('gen-count').innerText = `GEN ${generation}`;
            showBanner(`Generation ${generation} Started! Explore and survive!`);
        }

        function triggerExtinction(reason) {
            gameState = 'EVO_SHOP';
            audio.playExplosion();

            // Populate Evolution Modal UI
            document.getElementById('evo-reason').innerText = reason;
            document.getElementById('evo-dna-val').innerText = totalDna;
            
            // Update Upgrade Card Cost/Lvl Texts
            ['bite', 'speed', 'jump', 'time'].forEach(key => {
                document.getElementById(`lvl-${key}`).innerText = `LVL ${upgrades[key].lvl}`;
                document.getElementById(`cost-${key}`).innerText = `${upgrades[key].cost} DNA`;
            });

            document.getElementById('evolution-modal').classList.remove('hidden');
        }

        // Evolution Upgrade Purchase Logic
        function buyUpgrade(key) {
            audio.init();
            const up = upgrades[key];
            if (totalDna >= up.cost) {
                totalDna -= up.cost;
                up.lvl++;
                up.cost = Math.floor(up.cost * 1.5);
                audio.playDna();
                
                // Update UI
                document.getElementById('evo-dna-val').innerText = totalDna;
                document.getElementById(`lvl-${key}`).innerText = `LVL ${up.lvl}`;
                document.getElementById(`cost-${key}`).innerText = `${up.cost} DNA`;
                document.getElementById('dna-count').innerText = totalDna;
            }
        }

        // Setup UI Event Listeners
        document.getElementById('start-btn').addEventListener('click', () => {
            audio.init();
            startNewRun();
        });

        document.getElementById('next-gen-btn').addEventListener('click', () => {
            generation++;
            startNewRun();
        });

        document.getElementById('buy-bite').addEventListener('click', () => buyUpgrade('bite'));
        document.getElementById('buy-speed').addEventListener('click', () => buyUpgrade('speed'));
        document.getElementById('buy-jump').addEventListener('click', () => buyUpgrade('jump'));
        document.getElementById('buy-time').addEventListener('click', () => buyUpgrade('time'));

        /* Keyboard Input Listeners */
        window.addEventListener('keydown', e => {
            audio.init();
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
            if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
            if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') keys.jump = true;
            if (e.code === 'KeyJ' || e.code === 'KeyE') keys.bite = true;
        });

        window.addEventListener('keyup', e => {
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
            if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
            if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') keys.jump = false;
            if (e.code === 'KeyJ' || e.code === 'KeyE') keys.bite = false;
        });

        /* Touch / On-screen Button Listeners */
        const setupTouchBtn = (id, keyName) => {
            const btn = document.getElementById(id);
            const start = (e) => { e.preventDefault(); audio.init(); keys[keyName] = true; };
            const end = (e) => { e.preventDefault(); keys[keyName] = false; };
            btn.addEventListener('touchstart', start);
            btn.addEventListener('touchend', end);
            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', end);
        };
        setupTouchBtn('btn-left', 'left');
        setupTouchBtn('btn-right', 'right');
        setupTouchBtn('btn-jump', 'jump');
        setupTouchBtn('btn-bite', 'bite');

        // Canvas Click to Bite
        canvas.addEventListener('mousedown', () => {
            audio.init();
            keys.bite = true;
            setTimeout(() => keys.bite = false, 150);
        });

        /* Main Game Update & Animation Loop */
        function gameLoop(timestamp) {
            if (!lastTime) lastTime = timestamp;
            const dt = Math.min(0.1, (timestamp - lastTime) / 1000); // Delta time in seconds
            lastTime = timestamp;

            if (gameState === 'PLAYING') {
                // Update Extinction Meteor Timer
                timerRemaining -= dt;
                if (timerRemaining <= 0) {
                    timerRemaining = 0;
                    triggerExtinction("METEOR IMPACT OCCURRED!");
                }

                // Check Player Death by Hunger/Health
                if (player.hp <= 0) {
                    triggerExtinction("STARVATION / EXTINCTION!");
                }

                // Update Player
                player.update(dt);

                // Update Camera smooth follow
                camera.update(player.x + player.width / 2, player.y + player.height / 2);

                // Update Prey
                preyList.forEach(prey => prey.update(dt, player.x));

                // Check DNA pickups collection
                dnaPickups.forEach(dna => {
                    if (!dna.collected &&
                        player.x < dna.x + dna.width &&
                        player.x + player.width > dna.x &&
                        player.y < dna.y + dna.height &&
                        player.y + player.height > dna.y) {
                        
                        dna.collected = true;
                        currentRunDna += dna.val;
                        totalDna += dna.val;
                        audio.playDna();
                        showBanner(`+${dna.val} Ancient DNA Extracted!`);
                    }
                });

                // Update Particles
                for (let i = particleList.length - 1; i >= 0; i--) {
                    particleList[i].update();
                    if (particleList[i].life <= 0) particleList.splice(i, 1);
                }

                // Update HUD Displays
                document.getElementById('hp-bar').style.width = `${(player.hp / player.maxHp) * 100}%`;
                document.getElementById('hp-text').innerText = `${Math.ceil(player.hp)}%`;
                document.getElementById('dna-count').innerText = totalDna;
                document.getElementById('timer-display').innerText = `00:${timerRemaining.toFixed(1).padStart(4, '0')}`;
            }

            // Render Loop
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            // Draw Background Parallax
            drawParallaxBackground(ctx, camera);

            // Draw World Blocks
            drawWorldTiles(ctx, camera);

            // Draw Prey Entities
            preyList.forEach(prey => prey.draw(ctx, camera));

            // Draw Player Utahraptor
            player.draw(ctx, camera);

            // Draw Particles
            particleList.forEach(p => p.draw(ctx, camera));

            // Meteor Visual Threat (Falling embers when timer is low)
            if (gameState === 'PLAYING' && timerRemaining < 10) {
                ctx.fillStyle = '#f97316';
                for (let i = 0; i < 5; i++) {
                    const rx = (Math.random() * CANVAS_WIDTH);
                    const ry = (Math.random() * CANVAS_HEIGHT);
                    ctx.fillRect(rx, ry, 2, 8);
                }
            }

            // Render Minimap
            drawMinimap(player);

            requestAnimationFrame(gameLoop);
        }

        // Initialize First World Generation
        generateWorld();
        requestAnimationFrame(gameLoop);