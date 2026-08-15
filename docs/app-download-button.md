# App download button

The web portal exposes a visible **Download Moniepoint BRM App** entry point for both signed-out and signed-in users.

The native Expo app source already exists under `mobile/`, but an installable Android APK has not yet been signed/published. Until the binary is published, the download page states that clearly instead of linking to a non-existent file.

Once the APK is available, the download page can be updated to point at the final public installer without changing the portal navigation.
