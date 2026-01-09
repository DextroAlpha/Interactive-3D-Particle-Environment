# Interactive-3D-Particle-Environment
This system is an interactive 3D particle visualization controlled by real-time hand gestures. A Python backend uses camera-based hand tracking to detect finger positions and pinches, streams gesture data via WebSockets, and drives a browser-based Three.js particle environment with shape, motion, and color controls. 

This document describes the complete interactive 3D particle visualization system controlled by hand gestures.

## System Architecture

The system consists of 5 main components:

1. **hand_tracking.py** - Python backend using MediaPipe for hand detection
2. **particle_app.js** - Three.js frontend for 3D particle visualization
3. **particle_app.html** - HTML interface
4. **handTracking.js** - Legacy WebSocket client (optional)
5. **run_app.bat** - Windows batch script to launch everything

## Component Details

### 1. hand_tracking.py (Python Backend)

**Purpose**: Real-time hand tracking using MediaPipe, WebSocket server for browser communication

**Key Features**:
- MediaPipe Hands integration for accurate hand detection
- Fallback to OpenCV HSV+contour detection if MediaPipe unavailable
- Color-coded fingertips:
  - **Right Hand**: index=red, middle=blue, ring=orange, pinky=green, thumb=pink
  - **Left Hand**: index=purple, middle=black, ring=brown, pinky=yellow, thumb=pink
- Pinch detection for each finger-thumb combination
- WebSocket server on port 8765
- Real-time camera feed with overlay visualization
- CSV logging support (press 'c')
- Trail visualization (press 't')

**Data Structure Sent via WebSocket**:
```json
{
  "t": timestamp,
  "hands": [{
    "hand_id": 0,
    "index": [x_norm, y_norm],
    "thumb": [x_norm, y_norm],
    "distance_norm": 0.0-1.0,
    "side": "left" | "right",
    "pinch_finger": "index" | "middle" | "ring" | "pinky" | null,
    "pinch_distance_norm": 0.0-1.0,
    "finger_dist_norm": {
      "index": 0.0-1.0,
      "middle": 0.0-1.0,
      "ring": 0.0-1.0,
      "pinky": 0.0-1.0
    }
  }]
}
```

### 2. particle_app.js (Three.js Frontend)

**Purpose**: 3D particle visualization with hand gesture controls

**Key Features**:
- Three.js WebGL renderer
- Multiple particle shapes:
  - **Sphere** - Fibonacci sphere distribution
  - **Cube** - Surface distribution on cube faces
  - **Pyramid** - Triangular pyramid shape
  - **Halo** - Circular Halo-like shape

**Hand Controls**:

**Right Hand** (Shape Selection):
- Index + Thumb pinch → Sphere
- Middle + Thumb pinch → Cube
- Ring + Thumb pinch → Pyramid
- Pinky + Thumb pinch → Halo

**Left Hand** (Particle Behavior):
- **Index + Thumb**: Speed control
  - Maximum distance = freeze particles
  - Closer = faster movement
  - Pinch = maximum speed
- **Middle + Thumb**: Color cycling
- **Ring + Thumb**: Reverse rotation direction
- **Pinky + Thumb**: Freeze the particles

**Particle System**:
- Configurable particle count (1000-10000)
- Adjustable particle size (0.005-0.12)
- Color intensity control (0.2-2.0)
- Smooth morphing between shapes
- Animated particle oscillation
- Rotation with speed/direction control

### 3. particle_app.html

**Purpose**: User interface and container for the 3D canvas

**UI Elements**:
- Status indicator (connection state)
- Particle count slider
- Particle size slider
- Color intensity slider
- Instructions overlay

### 4. handTracking.js

**Purpose**: Legacy WebSocket client wrapper (optional, for backward compatibility)

**Note**: This file is maintained for compatibility but the main app uses direct WebSocket connection in particle_app.js

### 5. run_app.bat

**Purpose**: One-click launcher for the entire system

**Actions**:
1. Detects Python environment (.venv311 preferred, then .venv, then system)
2. Launches hand_tracking.py in new window
3. Launches HTTP server (port 8000) in new window
4. Opens browser to particle_app.html
5. Waits 3 seconds for servers to initialize

## Installation & Setup

### Prerequisites
- Python 3.11 (recommended) or Python 3.10
- Web browser with WebGL support

### Setup Steps

1. **Create Python virtual environment**:
```bash
py -3.11 -m venv .venv311
```

2. **Activate and install dependencies**:
```bash
.venv311\Scripts\activate
pip install opencv-python mediapipe websockets numpy
```

3. **Run the application**:
```bash
run_app.bat
```

Or manually:
```bash
# Terminal 1: Hand tracking
python hand_tracking.py

# Terminal 2: HTTP server
python -m http.server 8000

# Browser: Open http://localhost:8000/particle_app.html
```

## Usage Instructions

### Hand Tracking Window
- **'q' or ESC**: Quit
- **'c'**: Toggle CSV logging
- **'t'**: Toggle trail visualization
- **'w'**: Toggle WebSocket server (auto-starts by default)

### Particle Controls

**Right Hand Gestures**:
- Pinch thumb with different fingers to change particle shape
- Visual feedback: colored fingertips show which finger is active

**Left Hand Gestures**:
- **Index**: Control speed by distance from thumb
- **Middle**: Cycle through color schemes
- **Ring**: Reverse rotation direction
- **Pinky**: Display "Hello User" text

### UI Controls
- **Particle Count**: Adjust number of particles (affects performance)
- **Particle Size**: Change visual size of particles
- **Color Intensity**: Adjust color brightness

## Technical Details

### WebSocket Protocol
- **Server**: ws://localhost:8765
- **Protocol**: JSON messages
- **Update Rate**: ~30 FPS (depends on camera)
- **Reconnection**: Automatic with exponential backoff

### Performance Considerations
- Particle count affects frame rate
- Lower counts (1000-3000) recommended for older hardware
- Higher counts (5000-10000) for powerful systems
- WebGL required for rendering

### Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Full support
- Safari: May require WebGL enablement

## File Structure

```
project/
├── hand_tracking.py      # Python backend (hand detection + WebSocket server)
├── particle_app.js       # Three.js frontend (3D visualization)
├── particle_app.html     # HTML interface
├── handTracking.js       # Legacy WebSocket wrapper (optional)
├── run_app.bat          # Windows launcher script
├── requirements.txt     # Python dependencies
└── README.md            # This file
```

## Troubleshooting

### WebSocket Connection Failed
- Ensure hand_tracking.py is running
- Check firewall settings for port 8765
- Verify websockets package is installed

### Camera Not Working
- Check camera permissions
- Try different camera index in hand_tracking.py (change `cv2.VideoCapture(0)` to `cv2.VideoCapture(1)`)
- Ensure camera is not used by another application

### Particles Not Responding
- Check browser console for errors
- Verify WebSocket connection status in UI
- Ensure hand gestures are within camera view
- Check that fingers are clearly visible

### Performance Issues
- Reduce particle count
- Lower particle size
- Close other applications
- Use Chrome/Edge for best performance

## Future Enhancements

Potential improvements:
- Multi-hand support for complex gestures
- Additional particle shapes
- Sound effects synchronized with gestures
- Recording/playback of gesture sequences
- Custom text input for particle text
- Particle physics simulation
- VR/AR integration

## License & Credits

Built with:
- MediaPipe (Google)
- Three.js
- OpenCV
- Python websockets

---

**System Status**: Fully functional and tested
**Last Updated**: Current version
**Maintainer**: Development Team
