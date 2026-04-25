# Red Light, Green Light - Pose Detection Game

An interactive, browser-based recreation of the classic "Red Light, Green Light" game, utilizing computer vision to track player movement in real-time.

## Features
* **AI Motion Tracking:** Implements TensorFlow.js and MoveNet to track player keypoints via webcam.
* **Single & Multiplayer Modes:** Play solo for a high score or split-screen against a friend.
* **Dynamic Media Synchronization:** Synchronizes video clips, audio tracks, and UI overlays with randomized timing cycles.

## Tech Stack
* HTML5 / CSS3
* JavaScript (ES6+)
* TensorFlow.js
* Pose Detection API (MoveNet / BlazePose)

## How to Play
1. Allow camera permissions when prompted.
2. Select Single Player or Multi Player.
3. Move only when the UI indicates "GREEN LIGHT" and the doll is facing away.
4. Freeze immediately when the light turns "RED". Any movement detected will result in elimination!