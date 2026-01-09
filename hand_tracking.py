#!/usr/bin/env python3
"""
hand_tracking.py

Single-file hand & fingertip tracker for Python.
- Uses MediaPipe Hands if available (best accuracy).
- Falls back to OpenCV HSV+contour-based fingertips if MediaPipe is not installed.

Run:
    python hand_tracking.py

Press 'q' or ESC to quit.
"""

import sys
import time
from collections import deque

try:
    import mediapipe as mp
    HAS_MEDIAPIPE = True
except Exception:
    HAS_MEDIAPIPE = False

import cv2
import numpy as np
import csv
import json
import threading
import asyncio
import time as _time
try:
    import websockets
    HAS_WEBSOCKETS = True
except Exception:
    HAS_WEBSOCKETS = False


class MediaPipeHandTracker:
    def __init__(self, max_num_hands=2, min_detection_confidence=0.6, min_tracking_confidence=0.5):
        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(static_image_mode=False,
                                         max_num_hands=max_num_hands,
                                         min_detection_confidence=min_detection_confidence,
                                         min_tracking_confidence=min_tracking_confidence)
        self.mp_draw = mp.solutions.drawing_utils

    def process(self, frame):
        # Returns a list of hand infos (one per detected hand)
        h, w, _ = frame.shape
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb)
        hands_out = []
        if results.multi_hand_landmarks:
            for lm in results.multi_hand_landmarks:
                pts = [(int(l.x * w), int(l.y * h)) for l in lm.landmark]
                info = {}
                info['detected'] = True
                info['landmarks'] = pts
                info['thumb_tip'] = pts[4]
                info['index_tip'] = pts[8]
                info['fingertips'] = [pts[i] for i in (4, 8, 12, 16, 20)]
                info['fingertips_named'] = {
                    'thumb': pts[4],
                    'index': pts[8],
                    'middle': pts[12],
                    'ring': pts[16],
                    'pinky': pts[20]
                }
                info['center'] = (int((pts[0][0] + pts[9][0]) / 2), int((pts[0][1] + pts[9][1]) / 2))
                dx = info['index_tip'][0] - info['thumb_tip'][0]
                dy = info['index_tip'][1] - info['thumb_tip'][1]
                info['distance_index_thumb'] = float((dx*dx + dy*dy) ** 0.5)
                # Calculate hand size/distance from camera using wrist to middle finger tip distance
                wrist = pts[0]  # wrist landmark
                middle_tip = pts[12]  # middle finger tip
                hand_size_dx = middle_tip[0] - wrist[0]
                hand_size_dy = middle_tip[1] - wrist[1]
                hand_size_pixels = float((hand_size_dx*hand_size_dx + hand_size_dy*hand_size_dy) ** 0.5)
                # Normalize by frame diagonal for consistent scaling
                frame_diag = (w*w + h*h) ** 0.5
                info['hand_size_norm'] = hand_size_pixels / frame_diag
                hands_out.append(info)
        return hands_out

    def close(self):
        try:
            self.hands.close()
        except Exception:
            pass


class OpenCVHandTracker:
    """Fallback tracker using HSV skin segmentation + contour/convex hull heuristics.
    Supports detecting up to two largest hand blobs and returns list of hand infos.
    """
    def __init__(self):
        # smoothing buffers per detected hand (we store a short history of results)
        self.history = deque(maxlen=6)

    def _skin_mask(self, frame, lower1=(0,20,70), upper1=(20,255,255), lower2=(170,20,70), upper2=(180,255,255)):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower1 = np.array(lower1, dtype=np.uint8)
        upper1 = np.array(upper1, dtype=np.uint8)
        lower2 = np.array(lower2, dtype=np.uint8)
        upper2 = np.array(upper2, dtype=np.uint8)
        m1 = cv2.inRange(hsv, lower1, upper1)
        m2 = cv2.inRange(hsv, lower2, upper2)
        mask = cv2.bitwise_or(m1, m2)
        # morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.GaussianBlur(mask, (5, 5), 0)
        return mask

    def _extract_hand_info_from_contour(self, c, frame_shape):
        h, w = frame_shape
        info = {'detected': True, 'center': None, 'fingertips': [], 'index_tip': None, 'thumb_tip': None, 'distance_index_thumb': 0.0}
        M = cv2.moments(c)
        if M['m00'] != 0:
            cx = int(M['m10'] / M['m00'])
            cy = int(M['m01'] / M['m00'])
            info['center'] = (cx, cy)
        else:
            info['center'] = (w//2, h//2)
        # convex hull & topmost points as candidate fingertips
        hull = cv2.convexHull(c, returnPoints=True)
        hull_pts = [tuple(pt[0]) for pt in hull]
        hull_sorted = sorted(hull_pts, key=lambda p: p[1])
        tips = []
        for p in hull_sorted:
            if not tips:
                tips.append(p)
            else:
                if all(np.hypot(p[0]-q[0], p[1]-q[1]) > 25 for q in tips):
                    tips.append(p)
            if len(tips) >= 5:
                break
        info['fingertips'] = tips
        if len(tips) >= 2:
            # identify leftmost and rightmost among the top 3 as thumb/index heuristic
            topk = tips[:3]
            topk_sorted_x = sorted(topk, key=lambda p: p[0])
            info['thumb_tip'] = topk_sorted_x[0]
            info['index_tip'] = topk_sorted_x[-1]
            dx = info['index_tip'][0] - info['thumb_tip'][0]
            dy = info['index_tip'][1] - info['thumb_tip'][1]
            info['distance_index_thumb'] = float(np.hypot(dx, dy))
        return info

    def process(self, frame):
        h, w, _ = frame.shape
        mask = self._skin_mask(frame)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        hands_out = []
        if not contours:
            return hands_out
        # choose up to 2 largest contours (candidate hands)
        contours_sorted = sorted(contours, key=lambda c: cv2.contourArea(c), reverse=True)
        for c in contours_sorted[:2]:
            area = cv2.contourArea(c)
            if area < 2000:  # tuned min area to be smaller for more sensitivity
                continue
            info = self._extract_hand_info_from_contour(c, (h, w))
            hands_out.append(info)
        # smoothing history: keep recent lists
        self.history.append(hands_out)
        # return the latest smoothed hands (for now we return last directly)
        return hands_out



def draw_overlay(frame, hands, trails=None, backend_name='fallback'):
    h, w, _ = frame.shape
    if hands is None:
        return frame
    # BGR colors per hand
    finger_colors_right = {
        'index': (0, 0, 255),       # red
        'middle': (255, 0, 0),      # blue
        'ring': (0, 165, 255),      # orange
        'pinky': (0, 255, 0),       # green
        'thumb': (255, 0, 255),     # pink
    }
    finger_colors_left = {
        'index': (240, 32, 160),    # purple
        'middle': (0, 0, 0),        # black
        'ring': (42, 42, 128),      # brown-ish
        'pinky': (0, 255, 255),     # yellow
        'thumb': (255, 0, 255),     # pink
    }
    # draw each hand
    for hi, info in enumerate(hands):
        color_center = (0, 200, 0) if hi == 0 else (0, 150, 255)
        if info.get('center'):
            cv2.circle(frame, tuple(info['center']), 8, color_center, 2)
        # draw fingertips with per-finger colors
        if info.get('fingertips_named'):
            palette = finger_colors_right if info.get('side') == 'right' else finger_colors_left
            for name, tip in info['fingertips_named'].items():
                cv2.circle(frame, tuple(tip), 7, palette.get(name, (0, 200, 255)), -1)
                cv2.putText(frame, name[0].upper(), (tip[0]+6, tip[1]-6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1)
        else:
            for tip in info.get('fingertips', []) or []:
                cv2.circle(frame, tuple(tip), 6, (0, 200, 255), -1)
        if info.get('pinch_finger'):
            cv2.putText(frame, f"Pinch:{info['pinch_finger']}", (10, 25 + 18*hi), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,255,255), 2)
    cv2.putText(frame, f"Backend: {backend_name} | Hands: {len(hands)}", (10, frame.shape[0]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (230,230,230), 1)
    return frame


def main():
    print("Hand & Finger Tracking Demo\n")
    print("Checking backend...")
    if HAS_MEDIAPIPE:
        print("→ MediaPipe available: using MediaPipe Hands (recommended)")
        tracker = MediaPipeHandTracker()
        backend = 'MediaPipe'
    else:
        print("→ MediaPipe NOT available: using OpenCV fallback (HSV + contours)")
        tracker = OpenCVHandTracker()
        backend = 'OpenCV'

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: could not open camera (0). Try another camera index or check permissions.")
        return

    fps_time = time.time()
    frame_count = 0
    trails_enabled = True
    trails = {}
    trail_len = 20
    csv_logging = False
    csv_file = None
    csv_writer = None
    websocket_enabled = False

    # helper functions for CSV
    def start_csv():
        nonlocal csv_logging, csv_file, csv_writer
        if csv_logging:
            return
        csv_file = open('hand_log.csv', 'a', newline='')
        csv_writer = csv.writer(csv_file)
        csv_logging = True
        csv_writer.writerow(['timestamp', 'frame', 'hand_id', 'label', 'x_norm', 'y_norm', 'distance_norm'])
        print("CSV logging started -> hand_log.csv")

    def stop_csv():
        nonlocal csv_logging, csv_file, csv_writer
        if not csv_logging:
            return
        csv_logging = False
        try:
            csv_file.close()
            print("CSV logging stopped")
        except Exception:
            pass

    # simple websocket streamer if available
    ws_clients = set()
    broadcast_queue = []  # Simple list to queue messages for async broadcast

    async def ws_handler(websocket):
        ws_clients.add(websocket)
        try:
            # Receive messages (if any) and send queued broadcasts
            while True:
                # Check for queued broadcast messages and send them
                while broadcast_queue:
                    msg = broadcast_queue.pop(0)
                    try:
                        await websocket.send(msg)
                    except Exception:
                        pass
                # Brief delay to allow other tasks to run
                await asyncio.sleep(0.001)
        finally:
            ws_clients.discard(websocket)

    def start_ws_server(port=8765):
        nonlocal websocket_enabled
        if not HAS_WEBSOCKETS:
            print("Websockets package not available. Install with: pip install websockets")
            return
        if websocket_enabled:
            return
        
        async def main_loop():
            async with websockets.serve(ws_handler, '0.0.0.0', port):
                print(f"WebSocket server started on ws://localhost:{port}")
                await asyncio.Future()  # run forever
        
        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(main_loop())
        
        t = threading.Thread(target=run_loop, daemon=True)
        t.start()
        websocket_enabled = True

    def stop_ws_server():
        nonlocal websocket_enabled
        websocket_enabled = False
        print("WebSocket server flag cleared (server thread may keep running until process exit)")

    # Auto-start websocket server so browser clients can connect immediately
    if HAS_WEBSOCKETS:
        try:
            start_ws_server()
        except Exception:
            print("Warning: failed to start WebSocket server automatically")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Failed to read frame from camera")
                break
            frame = cv2.flip(frame, 1)
            hands = tracker.process(frame)

            # compute normalized positions for console reporting and streaming
            h, w, _ = frame.shape
            diag = (w*w + h*h) ** 0.5
            norm_hands = []
            for hi, info in enumerate(hands):
                ninfo = dict(info)
                if info.get('index_tip'):
                    ix, iy = info['index_tip']
                    ninfo['index_norm'] = (ix / w, iy / h)
                if info.get('thumb_tip'):
                    tx, ty = info['thumb_tip']
                    ninfo['thumb_norm'] = (tx / w, ty / h)
                # distances to thumb for each finger
                thumb_pt = info.get('thumb_tip')
                finger_min = None
                if thumb_pt and info.get('fingertips_named'):
                    dist_map = {}
                    for fname, pt in info['fingertips_named'].items():
                        if fname == 'thumb':
                            continue
                        dx = pt[0] - thumb_pt[0]
                        dy = pt[1] - thumb_pt[1]
                        dist = float((dx*dx + dy*dy) ** 0.5)
                        dist_map[fname] = dist / diag
                    ninfo['finger_dist_norm'] = dist_map
                    # choose closest finger below threshold
                    pinch_thresh = 0.05
                    if dist_map:
                        f_sorted = sorted(dist_map.items(), key=lambda kv: kv[1])
                        if f_sorted[0][1] < pinch_thresh:
                            finger_min = f_sorted[0][0]
                ninfo['distance_norm'] = info.get('distance_index_thumb', 0.0) / diag
                # Copy hand_size_norm if available (for zoom control)
                if 'hand_size_norm' in info:
                    ninfo['hand_size_norm'] = info['hand_size_norm']
                if finger_min:
                    ninfo['pinch_finger'] = finger_min
                    if 'finger_dist_norm' in ninfo and finger_min in ninfo['finger_dist_norm']:
                        ninfo['pinch_distance_norm'] = ninfo['finger_dist_norm'][finger_min]
                # approximate left/right hand based on center x position (frame already flipped)
                if info.get('center'):
                    cx, cy = info['center']
                    ninfo['side'] = 'left' if cx < (w/2) else 'right'
                else:
                    ninfo['side'] = None
                norm_hands.append(ninfo)

            frame_count += 1
            # lightweight console status once per second
            if time.time() - fps_time >= 1.0:
                summary = []
                for hi, hinfo in enumerate(norm_hands):
                    summary.append(f"H{hi}:{hinfo.get('side','?')} dist={hinfo.get('distance_norm',0):.3f}")
                print(f"FPS: {frame_count} | Hands: {len(norm_hands)} {' '.join(summary)}")
                frame_count = 0
                fps_time = time.time()
            # draw and show
            out = draw_overlay(frame.copy(), norm_hands, backend_name=backend)
            cv2.imshow('Hand & Finger Tracking', out)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                break
            elif key == ord('t'):
                trails_enabled = not trails_enabled
                if not trails_enabled:
                    trails.clear()
                print(f"Trails: {trails_enabled}")
            elif key == ord('c'):
                if not csv_logging:
                    start_csv()
                else:
                    stop_csv()
            elif key == ord('w'):
                if not websocket_enabled:
                    start_ws_server()
                else:
                    stop_ws_server()

            # streaming and logging
            if csv_logging and norm_hands:
                ts = _time.time()
                for hi, hinfo in enumerate(norm_hands):
                    for label in ('index', 'thumb'):
                        keypos = f"{label}_norm"
                        if keypos in hinfo:
                            x, y = hinfo[keypos]
                            csv_writer.writerow([ts, frame_count, hi, label, x, y, hinfo.get('distance_norm', 0.0)])
            # streaming to websocket clients
            if websocket_enabled and HAS_WEBSOCKETS and ws_clients:
                payload = {'t': _time.time(), 'hands': []}
                for hi, hinfo in enumerate(norm_hands):
                    payload['hands'].append({
                        'hand_id': hi,
                        'index': hinfo.get('index_norm'),
                        'thumb': hinfo.get('thumb_norm'),
                        'distance_norm': hinfo.get('distance_norm'),
                        'side': hinfo.get('side'),
                        'pinch_finger': hinfo.get('pinch_finger'),
                        'pinch_distance_norm': hinfo.get('pinch_distance_norm'),
                        'finger_dist_norm': hinfo.get('finger_dist_norm', {}),
                        'hand_size_norm': hinfo.get('hand_size_norm', 0.0)
                    })
                # Queue message for async broadcast
                msg = json.dumps(payload)
                broadcast_queue.append(msg)
    except KeyboardInterrupt:
        pass
    finally:
        if HAS_MEDIAPIPE:
            tracker.close()
        stop_csv()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
