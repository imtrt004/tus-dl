from flask import Flask, render_template, request, send_file, jsonify, redirect, url_for
from flask import Response, stream_with_context, send_from_directory
import time
import yt_dlp
import os
import uuid
import re
import platform
import subprocess
import json
import threading
import queue
import signal
import sys
import shutil
from werkzeug.utils import secure_filename
from datetime import datetime
import humanize

app = Flask(__name__)
app.config['DOWNLOAD_FOLDER'] = 'downloads'
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # 1GB max upload size
app.config['COOKIE_FILE'] = './static/cookies.txt'

# Create downloads folder if it doesn't exist
os.makedirs(app.config['DOWNLOAD_FOLDER'], exist_ok=True)
os.makedirs('./static', exist_ok=True)

# Add this global variable to store download progress
download_progress = {}

# Add a global progress queue and flag for shutdown
progress_queue = queue.Queue()
shutdown_flag = False


# Add this helper function to strip ANSI color codes
def strip_ansi_codes(text):
    """Remove ANSI color codes from text"""
    if not isinstance(text, str):
        return text

    # Pattern to match ANSI escape sequences
    ansi_pattern = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_pattern.sub('', text)


# Add this function to continuously send progress updates
def progress_sender():
    """Background thread that sends progress updates"""
    while not shutdown_flag:
        try:
            # Pull tasks from the queue with a timeout
            task_id, progress_data = progress_queue.get(timeout=0.5)

            # Store the progress data in the global dictionary
            download_progress[task_id] = progress_data

            # Print what's being stored
            #print(f"Updated progress for {task_id}: {progress_data}")

            # Mark task as done
            progress_queue.task_done()
        except queue.Empty:
            # No tasks in the queue, just continue
            pass
        except Exception as e:
            print(f"Error in progress sender: {e}")

        # Short sleep to prevent CPU spinning
        time.sleep(0.1)

# Start the progress sender thread when the app starts
progress_thread = threading.Thread(target=progress_sender, daemon=True)
progress_thread.start()

# Add a signal handler to gracefully shutdown
def signal_handler(sig, frame):
    global shutdown_flag
    shutdown_flag = True
    print("Shutting down progress thread...")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def get_browser_cookies():
    """Extract cookies from a browser and save to a file"""
    try:
        browser = request.form.get('browser', 'chrome').lower()

        # Check if browser is supported
        if platform.system() == 'Windows':
            if browser not in ['chrome', 'firefox', 'edge', 'opera']:
                return False, "Unsupported browser on Windows"
        elif platform.system() == 'Darwin':  # macOS
            if browser not in ['chrome', 'firefox', 'safari', 'edge']:
                return False, "Unsupported browser on macOS"
        else:  # Linux
            if browser not in ['chrome', 'firefox', 'opera']:
                return False, "Unsupported browser on Linux"

        # Import browser_cookie3 dynamically (install if missing)
        try:
            import browser_cookie3
        except ImportError:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "browser-cookie3"])
            import browser_cookie3

        # Get the appropriate function for the selected browser
        cookie_fn = None
        if browser == 'chrome':
            cookie_fn = browser_cookie3.chrome
        elif browser == 'firefox':
            cookie_fn = browser_cookie3.firefox
        elif browser == 'safari':
            cookie_fn = browser_cookie3.safari
        elif browser == 'edge':
            cookie_fn = browser_cookie3.edge
        elif browser == 'opera':
            cookie_fn = browser_cookie3.opera

        # Extract cookies for youtube.com domain
        cj = cookie_fn(domain_name='.youtube.com')

        # Write cookies to file
        with open(app.config['COOKIE_FILE'], 'w') as f:
            for cookie in cj:
                if cookie.domain.endswith('.youtube.com'):
                    f.write(f"{cookie.domain}\tTRUE\t{cookie.path}\t{cookie.secure}\t{cookie.expires}\t{cookie.name}\t{cookie.value}\n")

        return True, f"Cookies extracted from {browser} successfully"

    except Exception as e:
        print(f"Error extracting cookies: {str(e)}")
        return False, f"Failed to extract cookies: {str(e)}"

@app.route("/")
def home():
    # Check if cookies file exists and has content
    has_cookies = os.path.exists(app.config['COOKIE_FILE']) and os.path.getsize(app.config['COOKIE_FILE']) > 0
    return render_template("home.html", has_cookies=has_cookies)

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/extract_cookies", methods=["POST"])
def extract_cookies():
    success, message = get_browser_cookies()
    if success:
        return jsonify({"success": True, "message": message})
    else:
        return jsonify({"success": False, "error": message})

@app.route("/upload_cookies", methods=["POST"])
def upload_cookies():
    if 'cookie_file' not in request.files:
        return jsonify({"success": False, "error": "No file part"})

    file = request.files['cookie_file']

    if file.filename == '':
        return jsonify({"success": False, "error": "No selected file"})

    if file:
        filename = secure_filename(file.filename)
        file.save(app.config['COOKIE_FILE'])
        return jsonify({"success": True, "message": "Cookie file uploaded successfully"})

    return jsonify({"success": False, "error": "Unknown error"})

# Add this new route to get all supported sites
@app.route("/api/supported_sites")
def supported_sites():
    """Get a list of all sites supported by yt-dlp"""
    try:
        with yt_dlp.YoutubeDL() as ydl:
            ie_list = ydl._ies
            sites = []
            # Extract the sites
            for ie in ie_list:
                if hasattr(ie, 'IE_NAME') and ie.IE_NAME not in ('generic',):
                    sites.append(ie.IE_NAME)

        return jsonify({"success": True, "sites": sites})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

# Add a route for the supported sites page
@app.route("/supported_sites")
def supported_sites_page():
    return render_template("supported_sites.html")

@app.route("/download", methods=["POST"])
def download_video():
    video_url = request.form.get("video_url")
    format_option = request.form.get("format")

    if not video_url:
        return jsonify({"error": "No URL provided"}), 400

    # No need to validate for only YouTube URLs anymore
    # We'll let yt-dlp handle the validation

    # Generate a unique task ID and filename
    task_id = uuid.uuid4().hex
    filename = task_id  # Use the same ID for the task and file
    download_path = os.path.join(app.config['DOWNLOAD_FOLDER'], filename)

    # Initialize progress tracking
    download_progress[task_id] = {
        'status': 'starting',
        'progress': 0,
        'speed': '0 KiB/s',
        'eta': 'calculating',
        'size': 'unknown',
        'complete': False
    }

    # Create a closure to capture the task_id
    def progress_hook(d):
        """Hook to handle download progress updates from yt-dlp"""
        nonlocal task_id  # Use nonlocal to access the task_id from the outer function

        if d['status'] == 'downloading':
            # Get downloaded bytes and total bytes
            downloaded = d.get('downloaded_bytes', 0)
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)

            # Calculate percentage with one decimal place
            if total > 0:
                percent = round(downloaded / total * 100, 1)
            else:
                percent = 0

            # Get the formatted strings and strip ANSI color codes
            speed_str = strip_ansi_codes(d.get('_speed_str', '0 KiB/s'))
            eta_str = strip_ansi_codes(d.get('_eta_str', 'unknown'))
            size_str = strip_ansi_codes(d.get('_total_bytes_str', 'unknown'))

            # Print detailed progress information
            #print(f"[download] {percent}% of {size_str} at {speed_str} ETA {eta_str}")

            # Create progress info dictionary with clean values
            progress_info = {
                'status': 'downloading',
                'progress': percent,
                'speed': speed_str,
                'eta': eta_str,
                'size': size_str,
                'complete': False
            }

            # Put the progress info in the queue for the background thread
            progress_queue.put((task_id, progress_info))

            # Force flush stdout to see progress in real-time
            sys.stdout.flush()

        elif d['status'] == 'finished':
            # Update progress when download is finished and processing starts
            progress_info = {
                'status': 'processing',
                'progress': 100,
                'message': 'Processing file...',
                'complete': False
            }

            # Put the processing info in the queue
            progress_queue.put((task_id, progress_info))
            print("Download finished, processing file...")
            sys.stdout.flush()

    # Use a separate thread to handle the download to prevent blocking
    def download_thread():
        try:
            ydl_opts = {
                'outtmpl': f"{download_path}.%(ext)s",
                'progress_hooks': [progress_hook],
                'verbose': True,
                'quiet': False,  # Enable all output
                'no_warnings': False,  # Show warnings
            }

            # Add cookies file if available
            if os.path.exists(app.config['COOKIE_FILE']) and os.path.getsize(app.config['COOKIE_FILE']) > 0:
                ydl_opts['cookiefile'] = app.config['COOKIE_FILE']
                print(f"Using cookie file: {app.config['COOKIE_FILE']}")

            if format_option == 'audio':
                ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                })
                final_ext = 'mp3'
            else:  # video format
                if format_option == '720p':
                    ydl_opts['format'] = 'bestvideo[height<=720]+bestaudio/best[height<=720]'
                elif format_option == '1080p':
                    ydl_opts['format'] = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'
                else:  # best quality
                    ydl_opts['format'] = 'bestvideo+bestaudio/best'

                # Merge format requires additional postprocessing
                ydl_opts['postprocessors'] = [{
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': 'mp4',
                }]
                final_ext = 'mp4'

            print(f"Starting download with options: {ydl_opts}")
            sys.stdout.flush()

            # Send a progress update before starting the download
            progress_queue.put((task_id, {
                'status': 'starting',
                'progress': 0,
                'message': 'Starting download...',
                'complete': False
            }))

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                title = info.get('title', filename)

            # Find the actual file (yt-dlp might have named it differently)
            print(f"Looking for downloaded file matching {os.path.basename(download_path)}")
            final_file = None
            for file in os.listdir(app.config['DOWNLOAD_FOLDER']):
                if file.startswith(os.path.basename(download_path)):
                    final_file = os.path.join(app.config['DOWNLOAD_FOLDER'], file)
                    print(f"Found matching file: {final_file}")
                    break

            if not final_file:
                # If we couldn't find a file starting with the task_id, look for recent files
                print("No exact match found, looking for recently created files")
                for file in os.listdir(app.config['DOWNLOAD_FOLDER']):
                    file_path = os.path.join(app.config['DOWNLOAD_FOLDER'], file)
                    # Check for files created in the last minute
                    if os.path.getctime(file_path) > time.time() - 60:
                        final_file = file_path
                        print(f"Found recent file that's likely our download: {final_file}")
                        break

            # If still not found, use the default path
            if not final_file:
                final_file = f"{download_path}.{final_ext}"
                print(f"No matching file found, using default: {final_file}")

            # Mark download as complete
            complete_info = {
                'status': 'complete',
                'progress': 100,
                'title': title,
                'download_path': os.path.basename(final_file),
                'format': format_option,
                'complete': True,
                # Add these new fields:
                'original_filename': secure_filename(title) + '.' + final_ext,  # Sanitized filename based on video title
                'task_id': task_id  # Include task ID for reference
            }
            progress_queue.put((task_id, complete_info))
            print(f"Download complete: {title}")
            sys.stdout.flush()

        except Exception as e:
            error_msg = str(e)
            print(f"Download error: {error_msg}")
            sys.stdout.flush()

            # Check if error is about login required
            if "requested format not available" in error_msg:
                error_msg = "The requested format is not available. Try a different format."
            elif any(login_err in error_msg for login_err in ["login", "authentication", "sign in", "account"]):
                error_msg = "YouTube is requiring authentication. Please extract or upload cookies."

            # Update progress with error status
            error_info = {
                'status': 'error',
                'message': error_msg,
                'complete': True
            }
            progress_queue.put((task_id, error_info))

    # Start the download in a separate thread
    download_thread = threading.Thread(target=download_thread, daemon=True)
    download_thread.start()

    # Return the task ID immediately so the client can start getting progress updates
    return jsonify({
        "success": True,
        "task_id": task_id,
        "message": "Download started"
    })

# Add these routes to your Flask application
@app.route('/downloads')
def downloads():
    download_dir = os.path.join(app.root_path, 'downloads')
    files = []
    
    if os.path.exists(download_dir):
        for filename in os.listdir(download_dir):
            filepath = os.path.join(download_dir, filename)
            if os.path.isfile(filepath):
                # Get file stats
                stat = os.stat(filepath)
                size = humanize.naturalsize(stat.st_size)
                
                # Calculate expiry time (30 minutes after creation)
                created_time = stat.st_mtime
                expiry_time = created_time + (30 * 60)  # 30 minutes in seconds
                remaining = expiry_time - time.time()
                
                # Format the remaining time
                if remaining <= 0:
                    expires_in = "Expired"
                    expires_soon = True
                else:
                    minutes = int(remaining // 60)
                    seconds = int(remaining % 60)
                    expires_in = f"{minutes}m {seconds}s"
                    expires_soon = remaining < 300  # Less than 5 minutes
                
                # Determine file type based on extension
                file_type = "file"
                if filename.lower().endswith(('.mp4', '.webm', '.mkv', '.avi')):
                    file_type = "video"
                elif filename.lower().endswith(('.mp3', '.m4a', '.wav', '.ogg')):
                    file_type = "audio"
                
                files.append({
                    'name': filename,
                    'size': size,
                    'created': datetime.fromtimestamp(created_time).strftime('%Y-%m-%d %H:%M:%S'),
                    'expires_in': expires_in,
                    'expires_soon': expires_soon,
                    'expiry_timestamp': int(expiry_time),
                    'type': file_type
                })
    
    # Sort files by expiry time (soonest first)
    files.sort(key=lambda x: x['expiry_timestamp'])
    
    return render_template('download.html', files=files)

@app.route('/download/<filename>')
def download_file(filename):
    """Serve the file from the downloads directory"""
    # Create a copy to send, then delete the original after a delay
    file_path = os.path.join(app.config['DOWNLOAD_FOLDER'], filename)
    
    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404
        
    # Start a background thread to delete the file after download starts
    def delayed_delete():
        try:
            # Small delay to ensure download starts
            time.sleep(5)
            
            # Delete the file if it exists
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Deleted file after download: {file_path}")
        except Exception as e:
            print(f"Error in delayed delete: {e}")
    
    # Start the deletion thread
    threading.Thread(target=delayed_delete, daemon=True).start()
    
    # Serve the file
    return send_from_directory(
        app.config['DOWNLOAD_FOLDER'],
        filename,
        as_attachment=True
    )

@app.route("/progress/<task_id>")
def get_progress(task_id):
    def generate():
        last_progress = None
        attempts = 0
        max_attempts = 3600  # 6 minutes (0.1s * 3600)

        print(f"Starting progress stream for task {task_id}")
        sys.stdout.flush()

        # Always send an initial update
        initial_update = download_progress.get(task_id, {
            'status': 'starting',
            'progress': 0,
            'speed': '0 KiB/s',
            'eta': 'calculating',
            'size': 'unknown',
            'complete': False
        })
        yield f"data: {json.dumps(initial_update)}\n\n"
        last_progress = initial_update.copy()

        # Ensure the client gets this initial update
        sys.stdout.flush()

        # Keep track of last activity time
        last_activity_time = time.time()

        # Very short polling interval for real-time updates
        while attempts < max_attempts:
            # Get the current progress
            current_progress = download_progress.get(task_id, {})

            # Send update if progress changed or periodically
            if current_progress != last_progress or attempts % 10 == 0:  # Send updates every second (10 * 0.1s)
                #print(f"Sending progress update: {current_progress}")
                yield f"data: {json.dumps(current_progress)}\n\n"
                sys.stdout.flush()

                # Update last activity time
                last_activity_time = time.time()

                # Store a copy to prevent reference issues
                last_progress = current_progress.copy() if current_progress else None

                # Check if download is complete
                if current_progress.get('complete', False):
                    #print(f"Task {task_id} complete, ending progress stream")
                    # Send one final update to ensure client receives it
                    yield f"data: {json.dumps(current_progress)}\n\n"
                    break

            # Check for inactivity timeout (1 minute)
            if time.time() - last_activity_time > 60:
                print(f"No activity for 1 minute for task {task_id}, sending heartbeat")
                # Send a heartbeat to keep the connection alive
                yield f"data: {json.dumps(last_progress or {'status': 'downloading'})}\n\n"
                last_activity_time = time.time()

            # Very short polling interval (100ms) for more responsive updates
            time.sleep(0.1)
            attempts += 1

        # Send timeout message if we hit the limit
        if attempts >= max_attempts:
            error_data = {
                'status': 'error',
                'message': 'Download timed out after 6 minutes',
                'complete': True
            }
            yield f"data: {json.dumps(error_data)}\n\n"
            print(f"Task {task_id} timed out")

    # Set appropriate headers for SSE
    response = Response(stream_with_context(generate()), mimetype="text/event-stream")
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'  # For Nginx
    response.headers['Connection'] = 'keep-alive'
    return response

@app.route("/check_status/<task_id>")
def check_status(task_id):
    """Check the status of a download after connection issues"""
    progress_data = download_progress.get(task_id, {})

    # If the download is marked as complete, return the details
    if progress_data.get('complete', False) and progress_data.get('status') == 'complete':
        return jsonify({
            'success': True,
            'download_path': progress_data.get('download_path', ''),
            'title': progress_data.get('title', 'Unknown'),
            'format': progress_data.get('format', 'best'),
            'original_filename': progress_data.get('original_filename', '')
        })

    # If the download is still in progress, look for files that might match
    try:
        # Look for files matching the task ID pattern
        for file in os.listdir(app.config['DOWNLOAD_FOLDER']):
            if file.startswith(task_id):
                return jsonify({
                    'success': True,
                    'download_path': file,
                    'title': 'Downloaded Video',
                    'format': 'unknown'
                })
    except Exception as e:
        print(f"Error checking file status: {e}")

    # No files found, download probably failed
    return jsonify({'success': False, 'error': 'Download not found or incomplete'})

@app.route("/get_file/<filename>")
def get_file(filename):
    # First try to find a file that matches the filename directly
    for file in os.listdir(app.config['DOWNLOAD_FOLDER']):
        if file == filename or file.startswith(filename + '.'):
            file_path = os.path.join(app.config['DOWNLOAD_FOLDER'], file)

            # Look through all download progress data to find original filename
            original_filename = None
            for task_id, progress_data in download_progress.items():
                if progress_data.get('download_path') == file and progress_data.get('original_filename'):
                    original_filename = progress_data.get('original_filename')
                    break

            # Create a copy of the file to send, then delete the original
            # This way, even if the download is interrupted, the file is still deleted
            temp_path = os.path.join(app.config['DOWNLOAD_FOLDER'], f"temp_{filename}")
            try:
                # Copy the file to a temporary location
                shutil.copy2(file_path, temp_path)

                # Start a background thread to delete the original file
                def delayed_delete():
                    try:
                        # Small delay to ensure download starts
                        time.sleep(1)

                        # Delete the original file
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            print(f"Deleted original file: {file_path}")

                        # Wait a moment to ensure download has started
                        time.sleep(5)

                        # Delete the temp file too if it still exists
                        if os.path.exists(temp_path):
                            os.remove(temp_path)
                            print(f"Deleted temp file: {temp_path}")
                    except Exception as e:
                        print(f"Error in delayed delete: {e}")

                # Start the deletion thread
                threading.Thread(target=delayed_delete, daemon=True).start()

                # Send the temporary file with the original filename if available
                if original_filename:
                    return send_file(
                        temp_path,
                        as_attachment=True,
                        download_name=original_filename
                    )
                else:
                    return send_file(temp_path, as_attachment=True)

            except Exception as e:
                print(f"Error preparing file for download: {e}")
                # Fall back to sending the original if something goes wrong
                if original_filename:
                    return send_file(
                        file_path,
                        as_attachment=True,
                        download_name=original_filename
                    )
                else:
                    return send_file(file_path, as_attachment=True)

    return jsonify({"error": "File not found"}), 404

# Background cleanup function
def background_cleanup():
    """Background thread to clean up old files periodically"""
    while not shutdown_flag:
        try:
            # Wait 30 minutes between cleanup runs
            for i in range(30 * 60):  # Check shutdown flag every second
                if shutdown_flag:
                    break
                time.sleep(1)

            # Skip if app is shutting down
            if shutdown_flag:
                break

            print("Running background cleanup...")
            current_time = time.time()
            removed_count = 0

            # Remove files older than 30 minutes
            for file in os.listdir(app.config['DOWNLOAD_FOLDER']):
                file_path = os.path.join(app.config['DOWNLOAD_FOLDER'], file)

                # Skip if file doesn't exist (might have been deleted already)
                if not os.path.exists(file_path):
                    continue

                # Get file modification time (more reliable than creation time on some systems)
                file_time = os.path.getmtime(file_path)

                # If file is older than 30 minutes, delete it
                if (current_time - file_time) > (30 * 60):
                    try:
                        os.remove(file_path)
                        removed_count += 1
                    except Exception as e:
                        print(f"Error removing file {file}: {e}")

            print(f"Background cleanup complete. Removed {removed_count} files.")

        except Exception as e:
            print(f"Error in background cleanup: {e}")

@app.route("/cleanup", methods=["POST"])
def cleanup():
    """Clean up old downloads to save space"""
    try:
        # Keep track of how many files were removed
        removed_count = 0

        # Get current time
        current_time = time.time()

        # Remove files older than 30 minutes
        for file in os.listdir(app.config['DOWNLOAD_FOLDER']):
            file_path = os.path.join(app.config['DOWNLOAD_FOLDER'], file)

            # Get file creation time
            file_time = os.path.getctime(file_path)

            # If file is older than 30 minutes, delete it
            if (current_time - file_time) > (30 * 60):
                try:
                    os.remove(file_path)
                    removed_count += 1
                    print(f"Removed old file: {file}")
                except Exception as e:
                    print(f"Error removing file {file}: {e}")

        return jsonify({"success": True, "message": f"Removed {removed_count} old files"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

# Start the background cleanup thread when the app starts
cleanup_thread = threading.Thread(target=background_cleanup, daemon=True)
cleanup_thread.start()

# Add CORS headers to all responses
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

if __name__ == "__main__":
    # Start the Flask app
    app.run(debug=True, threaded=True)
