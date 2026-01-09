class HandTracker {
    constructor(videoElement) {
        this.video = videoElement;
        this.cameraActive = false;
        this.stream = null;
        this.handX = 0;
        this.handY = 0;
        this.useCamera = false;
        this.handState = 'open';
        this.handStateHistory = ['open', 'open', 'open'];
        this.lastHands = null;
        
        // WebSocket for Python hand tracking
        this.ws = null;
        this.wsConnected = false;
    }
    
    async startCamera() {
        try {
            // Connect to Python hand tracking server via WebSocket
            if (!this.wsConnected) {
                this.ws = new WebSocket('ws://localhost:8765');
                
                this.ws.onopen = () => {
                    console.log('Connected to hand tracking server');
                    this.wsConnected = true;
                    this.cameraActive = true;
                    this.useCamera = true;
                };
                
                this.ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.error) {
                        console.error('Server error:', data.error);
                        return;
                    }
                    
                    // Update hand info from Python server
                    if (data.detected) {
                        this.lastHands = [{
                            index: { x: data.index_tip[0], y: data.index_tip[1] },
                            thumb: { x: data.thumb_tip[0], y: data.thumb_tip[1] },
                            distance: data.distance,
                            center: { x: data.hand_center[0], y: data.hand_center[1] }
                        }];
                        
                        // Map to canvas coordinates
                        const canvas = document.getElementById('particleCanvas');
                        if (canvas) {
                            const rect = canvas.getBoundingClientRect();
                            const scaleX = rect.width / data.frame_width;
                            const scaleY = rect.height / data.frame_height;
                            
                            if (this.lastHands[0].index) {
                                this.lastHands[0].index.x *= scaleX;
                                this.lastHands[0].index.y *= scaleY;
                            }
                            if (this.lastHands[0].thumb) {
                                this.lastHands[0].thumb.x *= scaleX;
                                this.lastHands[0].thumb.y *= scaleY;
                            }
                            this.lastHands[0].center.x *= scaleX;
                            this.lastHands[0].center.y *= scaleY;
                        }
                        
                        // Simple hand state detection based on distance
                        this.handState = data.distance < 50 ? 'closed' : 'open';
                    } else {
                        this.lastHands = null;
                    }
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.wsConnected = false;
                };
                
                this.ws.onclose = () => {
                    console.log('Disconnected from hand tracking server');
                    this.wsConnected = false;
                };
            }
            
            return true;
        } catch (error) {
            console.error('Camera error:', error);
            throw error;
        }
    }
    
    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.ws) {
            this.ws.close();
            this.wsConnected = false;
        }
        this.video.style.display = 'none';
        this.video.srcObject = null;
        this.cameraActive = false;
        this.useCamera = false;
    }
    
    // Hand detection is now handled server-side via Python MediaPipe.
    // This method is a no-op; hand data arrives via WebSocket in startCamera().
    detectHand(canvas) {
        // No-op: hand tracking done server-side
    }

    getFingers() {
        // Returns array of fingertip objects (index/thumb) for backward compatibility
        const out = [];
        if (!this.lastHands || !this.lastHands[0]) return out;
        const h = this.lastHands[0];
        if (h.index) out.push(h.index);
        if (h.thumb) out.push(h.thumb);
        return out;
    }

    getHand() {
        // Returns single hand info: {index, thumb, distance, center} or null
        if (!this.lastHands || this.lastHands.length === 0) return null;
        return this.lastHands[0];
    }
}
