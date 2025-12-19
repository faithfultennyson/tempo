# Dice Physics Test - Standalone Simulator

This is a self-contained dice physics simulation with **mid-air freeze bug detection and auto-fix**.

## Critical Bug Fixed: "Invisible Platform" Mid-Air Freeze

### The Bug:
Dice sometimes get stuck mid-air as if sitting on an invisible platform. This is a **collision detection bug** in Cannon.js where:
- Dice collide with wall geometry mid-air
- Or "ghost collisions" create false contact points
- Body thinks it's resting on something when it's not

### The Fix (3-Part Solution):

**1. Reduced Wall Height**
```javascript
WALL_HEIGHT: 2.5  // Down from 3.5 to prevent mid-air collisions
```

**2. Mid-Air Freeze Detection**
```javascript
// Checks every frame:
if (dice.y > 1.5 && dice.velocity < 0.02) {
  // Dice is mid-air but not moving = FROZEN
  applyEmergencyImpulse();
}
```

**3. Visual Debug Mode**
- Red wireframe shows exact collision zones
- See where walls actually are vs where dice think they are
- Toggle with "Toggle Walls" button

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Make Sure Your Assets Are Available

Your project structure should look like:
```
dice-physics-test/
├── assets/
│   ├── board_1024.png
│   ├── Dice.obj
│   ├── Dice.mtl (optional)
│   └── dice.png
├── index.html
├── server.js
├── package.json
└── README.md
```

### 3. Run the Server
```bash
npm start
```

### 4. Open in Browser
Navigate to: **http://localhost:3333**

## How to Test for the Bug

### Manual Testing:
1. **Roll dice 20+ times** (bug happens randomly, ~10-30% of rolls)
2. **Watch carefully** during the fall - do dice ever "pause" mid-air?
3. **Check browser console** for warnings: `🚨 MID-AIR FREEZE DETECTED`
4. **Enable "Debug Info"** to see velocity values - should never be near-zero mid-air
5. **Toggle wall visibility** to see if dice are colliding with walls

### What to Look For:

**❌ The Bug Looks Like:**
- Dice suddenly stops falling mid-air (Y > 1.5)
- Looks like sitting on invisible platform
- Velocity near zero but not touching ground
- May tilt or roll on the "platform"
- Eventually falls when physics "unsticks" it (or never falls)

**✅ When Fixed:**
- Continuous smooth fall
- Velocity always high during descent
- No sudden stops or pauses
- Console shows no freeze warnings
- Dice only stop when touching ground

### Using the Debug Tools:

**1. Debug Info Panel (top-left)**
```
Dice 1:
  Pos: (0.5, 3.2, -0.8)   ← Y position
  Vel: 8.234              ← Should be high during fall
  AngVel: 12.45
  Freeze: ✓               ← Freeze counter (0 = good, >0 = freezing)
```

**2. Red Wireframe Walls**
- Shows EXACT collision boundaries
- If dice overlaps red wireframe mid-air = collision bug
- Helps identify wall geometry issues

**3. Browser Console Warnings**
```
⚠️ Dice 0 collided with static body at Y=3.45
🚨 MID-AIR FREEZE DETECTED! Dice 0 at Y=3.12, vel=0.018
Applying emergency impulse...
```

**4. Visual Alert**
- Red pulsing alert appears when freeze detected
- Confirms auto-fix is working

✅ **Pure Physics Simulation** - No network calls, all local  
✅ **Realistic Drop Mechanics**:
  - **Impulse-based dropping** (force applied, like real dice)
  - Not velocity-based (no "platform disappears" feeling)
  - Dice start moving immediately with momentum
✅ **Better Scale & View**:
  - Smaller dice (1.5 units, was 2)
  - Bigger board (14x14, was 10x10)
  - Zoomed out camera for better perspective
✅ **Same Face Mapping** - Uses your texture mapping configuration  
✅ **Real-time Rendering** - See the dice fall and settle in real-time  
✅ **Debug Mode** - Click "Debug Info" to see velocity, position, and settlement data  

## Key Physics Fix: Impulse vs Velocity

### ❌ OLD WAY (Velocity):
```javascript
body.velocity.set(0, -0.5, 0);
```
**Problem:** Dice "rest" for a frame, then start falling  
**Feels like:** Platform disappearing beneath them

### ✅ NEW WAY (Impulse):
```javascript
const impulse = new CANNON.Vec3(
  (Math.random() - 0.5) * 0.8,  // Random horizontal
  -3.5,                          // Strong downward force
  (Math.random() - 0.5) * 0.8
);
body.applyImpulse(impulse, body.position);
```
**Result:** Dice are "thrown/dropped" with force  
**Feels like:** Real dice being tossed onto table

**Why impulse is better:**
- Applies instant force (momentum transfer)
- Physics engine immediately recognizes motion
- No "at rest" detection edge case
- Simulates actual dice throwing motion  

## Why This Bug Happens (Technical Details)

### Root Cause: Cannon.js Collision Detection Edge Cases

**1. SAP Broadphase False Positives**
- Cannon.js uses Sweep and Prune (SAP) for collision detection
- Can generate "ghost contacts" between non-touching bodies
- Especially when bodies are rotating/tumbling near walls

**2. Contact Equation Solver Artifacts**
- When solving contact constraints, solver can create fake "resting contacts"
- These contacts have zero separation but aren't real collisions
- Body thinks it's resting on something = freeze

**3. Wall Geometry Collisions**
- Tall walls (3.5+ units) extend into dice spawn/fall zone
- Rotating dice can clip wall corners mid-air
- Creates brief contact that tricks sleep detection

### Why the Fixes Work:

**Lower Walls (2.5 units)**
- Reduces chance of mid-air wall collisions
- Dice fall zone is further from wall geometry
- Still contains dice that roll to edges

**Freeze Detection + Auto-Fix**
- Catches edge cases that slip through
- Applies "emergency impulse" to unstick dice
- Failsafe for unexpected scenarios

**Reduced Dice-Dice Friction**
- Prevents dice from "sticking" to each other mid-air
- Allows them to slide apart naturally
- Reduces chance of clustered freezes

## Alternative Solutions (If Bug Persists)

If the 3-part fix doesn't eliminate the bug completely:

### Option A: Invisible Cylinder Containment
Replace box walls with a cylinder boundary:
```javascript
// In setupTable(), replace wall creation with:
const cylinderRadius = this.tableSize / 2;
const cylinderShape = new CANNON.Cylinder(cylinderRadius, cylinderRadius, 5, 16);
const cylinderBody = new CANNON.Body({ mass: 0 });
cylinderBody.addShape(cylinderShape);
world.add(cylinderBody);
```
**Pros:** No corners to clip, smoother containment  
**Cons:** Requires client-side visual cylinder

### Option B: Soft Boundary Forces
Instead of hard walls, apply repulsive forces:
```javascript
// In step(), check dice position and push back if near edge
dice.forEach(body => {
  const dist = Math.sqrt(body.position.x**2 + body.position.z**2);
  if (dist > tableSize / 2 - 1) {
    const force = new CANNON.Vec3(
      -body.position.x * 10,
      0,
      -body.position.z * 10
    );
    body.applyForce(force, body.position);
  }
});
```
**Pros:** No collision detection issues  
**Cons:** Dice can technically go out of bounds briefly

### Option C: Switch Physics Engine
If Cannon.js proves too buggy:
- **Rapier.js** - Modern, stable, better collision detection
- **Ammo.js** - Bullet physics port, industry standard
- **Oimo.js** - Similar to Cannon, might have fewer edge cases

## Production Readiness Checklist

Before deploying to production:

- [ ] Test with 50+ rolls - no freezes detected
- [ ] Freeze detector triggers less than 1% of rolls (ideally 0%)
- [ ] Console logs clean (no collision warnings)
- [ ] Dice settle consistently within 2 seconds
- [ ] All face values detected correctly
- [ ] Works across browsers (Chrome, Firefox, Safari)
- [ ] Network latency doesn't cause visual glitches
- [ ] Emergency impulse feels natural (not jarring)
- [ ] Monitoring/logging in place to track freeze occurrences

## Monitoring in Production

Add server-side logging:
```javascript
// In checkMidAirFreeze()
if (this.freezeDetector[i] > 10) {
  console.warn(`[PRODUCTION] Mid-air freeze: ${die.id} at Y=${y}`);
  // Send to monitoring service (Sentry, DataDog, etc.)
  logToMonitoring('dice_freeze_detected', { dieId: die.id, position: y });
}
```

Track metrics:
- Freeze occurrence rate (per 1000 rolls)
- Average time to settlement
- Collision warnings per roll
- Emergency impulse trigger rate

If freeze rate > 1% in production, consider switching physics engines.

### What We're Using: **Cannon.js**
- Lightweight 3D physics engine
- Your server uses **cannon-es** (ES6 port, same core)
- Good for simple rigid body physics
- Known limitation: Sensitive to "at rest" edge cases

### Why Impulse Works Better Than Velocity:

**Physics engines work in two modes:**
1. **Kinematic** (you set velocity directly) - can confuse sleep detection
2. **Dynamic** (you apply forces/impulses) - engine handles everything naturally

**Impulse = Force × Time (momentum transfer)**
- Simulates real-world physics (dropping/throwing)
- Engine immediately recognizes as "active motion"
- No sleep detection false positives
- More realistic dice behavior

### If Freezing Still Occurs After Using Impulse:

Try increasing impulse strength:
```javascript
const impulse = new CANNON.Vec3(0, -5.0, 0); // Stronger drop (was -3.5)
```

Or disable sleep entirely during rolls:
```javascript
world.allowSleep = false; // In rollDice()
world.allowSleep = true;  // After settlement
```

### Alternative Physics Engines (if Cannon.js still problematic):

| Engine | Pros | Cons | Use Case |
|--------|------|------|----------|
| **Cannon.js** | Lightweight, simple API | Sleep issues | Simple games |
| **Rapier** | Fast, modern, stable | Larger bundle | Production apps |
| **Ammo.js** | Industry standard | Complex API | AAA quality needed |
| **Oimo.js** | Lightweight alternative | Less maintained | Similar to Cannon |

**Recommendation:** If impulse + wake-up fixes the issue, **stick with Cannon.js**. It's the simplest and lightest option.

## What to Look For

### Good Simulation Should Show:
1. ✅ Dice **immediately start falling** after roll button click
2. ✅ No mid-air freezing or pauses
3. ✅ Dice settle within **1-2 seconds**
4. ✅ Both dice behave consistently
5. ✅ Correct face values displayed

### Problems to Watch For:
1. ❌ Dice appear frozen at spawn height
2. ❌ One or both dice freeze mid-air
3. ❌ Very slow descent (more than 3 seconds)
4. ❌ Dice never settle
5. ❌ Wrong face values

## Applying Fixes to Your Production Server

If the test shows the bug is fixed, apply these changes to your server:

### 1. Update `DicePhysicsSimulation.js` Constructor:

```javascript
constructor() {
  // ... existing code ...
  this.wallHeight = 2.5; // Reduce from 3.5
  this.freezeDetector = []; // Add freeze detection
  // ... rest of constructor ...
}
```

### 2. Reduce Wall Height in `setupTable()`:

```javascript
setupTable() {
  // ... ground setup ...
  
  const wallHeight = this.wallHeight; // Use 2.5 instead of 3.5
  const wallThickness = 0.3; // Reduce from 0.4
  
  // ... rest of wall setup ...
}
```

### 3. Add Mid-Air Freeze Detection to `step()`:

```javascript
step(deltaTime) {
  this.world.step(1 / 60, deltaTime, 3);
  
  // Add freeze detection during active rolls
  if (this.isRolling) {
    this.checkMidAirFreeze();
  }
}

checkMidAirFreeze() {
  this.dice.forEach((die, i) => {
    const body = die.body;
    const vel = body.velocity.length();
    const y = body.position.y;
    
    // Detect freeze: mid-air + near-zero velocity
    if (y > 1.5 && vel < 0.02) {
      if (!this.freezeDetector[i]) {
        this.freezeDetector[i] = 0;
      }
      this.freezeDetector[i]++;
      
      // Auto-fix after 10 frames
      if (this.freezeDetector[i] > 10) {
        console.warn(`Mid-air freeze detected for ${die.id}, applying fix`);
        const impulse = new CANNON.Vec3(
          (Math.random() - 0.5) * 2,
          -5.0,
          (Math.random() - 0.5) * 2
        );
        body.applyImpulse(impulse, body.position);
        body.wakeUp();
        this.freezeDetector[i] = 0;
      }
    } else {
      this.freezeDetector[i] = 0;
    }
  });
}
```

### 4. Reduce Dice-to-Dice Friction in `rollDice()`:

```javascript
// Add after creating diceMaterial and tableMaterial
this.world.addContactMaterial(
  new CANNON.ContactMaterial(this.diceMaterial, this.diceMaterial, {
    friction: 0.1,  // Very low to prevent sticking
    restitution: 0.2
  })
);
```

### 5. Add Collision Logging (Optional, for debugging):

```javascript
// In createDie(), after world.addBody(body):
body.addEventListener('collide', (e) => {
  if (body.position.y > 1.5 && e.body.mass === 0) {
    console.warn(`${id} mid-air collision at Y=${body.position.y.toFixed(2)}`);
  }
});
```

### 6. Reset Freeze Detector in `rollDice()`:

```javascript
rollDice(numberOfDice = 2) {
  this.cleanup();
  this.dice = [];
  this.freezeDetector = []; // Reset freeze detector
  this.world.allowSleep = false;
  // ... rest of rollDice ...
}
```

Apply the impulse-based approach to your server code:

### In `DicePhysicsSimulation.js`:

**1. Update dice size and board:**
```javascript
constructor() {
  // ...
  this.tableSize = 14; // Bigger board (was 10)
  this.diceSize = 1.5; // Smaller dice (was 2)
  // ...
}

createDie(id, initialPos, initialVel, initialAngVel) {
  const size = 1.5; // Update here too
  const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
  // ...
}
```

**2. Replace velocity with impulse in rollDice():**
```javascript
// After body.position.set(...)
// REMOVE THIS:
// body.velocity.set(initialVel.x, initialVel.y, initialVel.z);

// ADD THIS INSTEAD:
const dropImpulse = new CANNON.Vec3(
  (Math.random() - 0.5) * 0.8,  // Random horizontal
  -3.5,                          // Strong downward force
  (Math.random() - 0.5) * 0.8
);
body.applyImpulse(dropImpulse, body.position);

// Keep angular velocity as is
body.angularVelocity.set(initialAngVel.x, initialAngVel.y, initialAngVel.z);

// Force awake
body.wakeUp();
if (body.sleepState !== undefined) {
  body.sleepState = CANNON.Body.AWAKE;
}
```

**3. Update spawn parameters:**
```javascript
const spawnHeightMin = 4.5;
const spawnHeightMax = 5.5;
const minSeparation = 2.8;
const spawnRadiusMax = 1.5; // Wider spawn area for bigger board
```

**4. Update client dice scale:**
In your Three.js client code, scale dice meshes:
```javascript
dice.scale.set(0.75, 0.75, 0.75); // Match visual to physics
```

**5. Update camera position:**
```javascript
camera.position.set(0, 18, 24); // Zoom out for bigger board
```

## If It Still Freezes:

1. **Check browser console** for Cannon.js warnings
2. **Watch debug velocity values** - should never show 0.0 during fall
3. **Try increasing initial downward velocity** to -1.0 or -2.0
4. **Consider switching to Rapier.js** for more reliable physics

If freeze rate > 1% in production, consider switching physics engines.

---

## Summary

This test environment adds:
1. ✅ **Lower walls** (2.5 units) - prevents mid-air collisions
2. ✅ **Real-time freeze detection** - catches bug when it happens
3. ✅ **Auto-fix with emergency impulse** - unsticks frozen dice
4. ✅ **Visual debugging** (red wireframes) - see collision zones
5. ✅ **Console logging** - track when/where freezes occur
6. ✅ **Reduced dice-dice friction** - prevents sticking
7. ✅ **Collision event listeners** - logs mid-air collisions

**The Goal:** Reduce freeze occurrence from ~10-30% to <1% (ideally 0%).

Roll the dice 50+ times and watch the console. If you see **NO freeze warnings**, the fix works! 🎉

If you still see freezes despite all fixes, Cannon.js might not be reliable enough for production, and switching to Rapier.js is recommended.

Test the simulation and verify:

- [ ] Dice spawn at proper height and size (smaller, visible)
- [ ] Board is bigger with better perspective
- [ ] **Dice drop IMMEDIATELY with momentum** ← MAIN FIX
- [ ] No "resting then falling" feeling
- [ ] No mid-air freezing at any point
- [ ] Dice tumble naturally during fall
- [ ] Settle within 1-2 seconds
- [ ] Correct face values displayed
- [ ] Debug shows velocity starts high, decreases smoothly
- [ ] Multiple rolls feel consistent

### What Good Physics Should Look Like:

**At spawn (frame 0):**
- Position: (random X, 4.5-5.5, random Z)
- Velocity: Already moving (~3.5 m/s downward)
- State: AWAKE

**During fall:**
- Velocity increases (gravity accelerating)
- Angular velocity causes tumbling
- No sudden stops or pauses

**At settlement:**
- Velocity smoothly approaches 0
- Dice rest on one face
- Settlement timer confirms stability

## Common Issues & Solutions

### Issue: "Dice still pause briefly at spawn"
**Solution:** Increase drop impulse from 3.5 to 5.0 or 6.0

### Issue: "Dice fly off the board"
**Solution:** Reduce impulse or increase board size further

### Issue: "Dice don't tumble enough"
**Solution:** Increase angular velocity range (try ±20 instead of ±16)

### Issue: "Dice take too long to settle"
**Solution:** Increase friction/damping or reduce bounce (restitution)

### Issue: "Debug shows velocity = 0.00 during fall"
**Solution:** Impulse not applied correctly, check impulse application code

---

## Quick Reference: Key Code Snippets

### Impulse Application (Copy-Paste Ready)
```javascript
// In your rollDice() function, after creating body and setting position:
const dropImpulse = new CANNON.Vec3(
  (Math.random() - 0.5) * 0.8,  // Random horizontal spread
  -3.5,                          // Downward force (adjust 3.5 to 5.0 for stronger drop)
  (Math.random() - 0.5) * 0.8
);
body.applyImpulse(dropImpulse, body.position);
body.wakeUp();
body.sleepState = CANNON.Body.AWAKE;
```

### Updated Config Values
```javascript
TABLE_SIZE: 14          // Was 10
DICE_SIZE: 1.5          // Was 2
DICE_VISUAL_SCALE: 0.75 // For Three.js meshes
SPAWN_HEIGHT: 4.5-5.5   // Was 3.0-4.0
SEPARATION: 2.8         // Was 1.8
SPAWN_RADIUS_MAX: 1.5   // Was 1.1
DROP_IMPULSE: 3.5       // NEW - key parameter
```

### Camera Update
```javascript
camera.position.set(0, 18, 24); // Zoomed out for bigger board
```

**Remember:** The impulse approach is the key fix. Everything else is optimization!

### If dice don't appear:
- Check browser console for asset loading errors
- Verify assets folder path is correct
- Check if Dice.obj file is valid

### If physics feels wrong:
- Check debug info (top right button)
- Look at velocity values - should decrease smoothly
- Settlement timer should count up when dice are still

### If assets don't load:
The simulation will use fallback:
- Plain green board
- White cube dice
- Still tests the physics correctly

## Comparing to Your Server

If this works perfectly but your server doesn't:
- **Issue is likely in network streaming**
- Check `STATE_UPDATE` timing
- Verify client interpolation
- Look at network latency effects

If this shows the same problems:
- **Issue is in the physics simulation itself**
- Check `DicePhysicsSimulation.js` settings
- Verify gravity, damping, and materials
- Test different spawn parameters

## Key Differences from Server

This standalone version:
- No WebSocket communication
- No STATE_UPDATE messages
- Direct mesh-body synchronization every frame
- Uses browser's cannon.js (slightly different from cannon-es)

Your server version:
- WebSocket STATE_UPDATE at 20Hz
- Physics runs at 60Hz server-side
- Client interpolates between states
- Uses cannon-es npm package