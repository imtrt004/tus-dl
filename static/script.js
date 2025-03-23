// Helper function to strip ANSI codes
function stripAnsiCodes(str) {
  if (typeof str !== "string") return str;
  // Strip ANSI escape sequences
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

document.addEventListener("DOMContentLoaded", function () {
  const downloadForm = document.getElementById("downloadForm");
  const videoUrlInput = document.getElementById("videoUrl");
  const statusElement = document.getElementById("status");
  const resultElement = document.getElementById("result");
  const videoTitleElement = document.getElementById("videoTitle");
  const formatInfoElement = document.getElementById("formatInfo");
  const downloadBtn = document.getElementById("downloadBtn");
  const cookieModal = document.getElementById("cookieModal");
  const closeBtn = document.getElementById("closeModalBtn");
  const extractCookiesForm = document.getElementById("extractCookiesForm");
  const uploadCookiesForm = document.getElementById("uploadCookiesForm");
  const manageCookiesBtn = document.getElementById("manageCookiesBtn");

  // Progress bar elements
  const progressContainer = document.getElementById("progressContainer");
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const progressSize = document.getElementById("progressSize");
  const progressSpeed = document.getElementById("progressSpeed");
  const progressEta = document.getElementById("progressEta");
  const progressStatus = document.getElementById("progressStatus");

  // Store the filename for download
  let downloadFilename = "";
  let pendingDownload = null;
  let eventSource = null; // For SSE connection
  let activeTaskId = null; // Track the current task ID

  // Check for active downloads from localStorage when page loads
  function restoreDownloadState() {
    try {
      const savedState = localStorage.getItem("downloadState");
      if (savedState) {
        const state = JSON.parse(savedState);

        if (state && state.taskId) {
          console.log("Found saved download state with task ID:", state.taskId);

          // Check if the download is still valid on the server
          fetch(`/check_status/${state.taskId}`)
            .then((response) => response.json())
            .then((data) => {
              if (data.success && data.download_path) {
                console.log(
                  "Download is still valid on server, restoring state"
                );

                activeTaskId = state.taskId;

                // If download is complete, show download button
                if (state.status === "complete") {
                  progressContainer.classList.add("hidden");

                  // Update result elements
                  videoTitleElement.textContent = `Title: ${
                    data.title || state.title || "Downloaded Video"
                  }`;

                  let formatText = "";
                  switch (data.format || state.format) {
                    case "audio":
                      formatText = "MP3 Audio";
                      break;
                    case "720p":
                      formatText = "720p Video";
                      break;
                    case "1080p":
                      formatText = "1080p Video";
                      break;
                    default:
                      formatText = "Best Quality Video";
                  }

                  formatInfoElement.textContent = `Format: ${formatText}`;
                  downloadFilename = data.download_path;

                  // Clear any existing file info notes
                  const existingNotes =
                    resultElement.querySelectorAll(".file-info-note");
                  existingNotes.forEach((note) => note.remove());

                  // Show original filename if available
                  if (data.original_filename || state.original_filename) {
                    const filenameInfo = document.createElement("p");
                    filenameInfo.className = "file-info";
                    filenameInfo.innerHTML = `File: <span class="file-name">${
                      data.original_filename || state.original_filename
                    }</span>`;
                    resultElement
                      .querySelector(".download-info")
                      .appendChild(filenameInfo);
                  }

                  // Add note about automatic deletion
                  const deleteNote = document.createElement("p");
                  deleteNote.className = "file-info-note";
                  deleteNote.innerHTML =
                    '⚠️ <span class="note-text">File will be automatically deleted after download for privacy</span>';
                  resultElement
                    .querySelector(".download-info")
                    .appendChild(deleteNote);

                  resultElement.classList.remove("hidden");
                }
                // If download was in progress, reconnect to progress events
                else if (
                  state.status === "downloading" ||
                  state.status === "processing"
                ) {
                  // Restore progress UI
                  progressContainer.classList.remove("hidden");
                  resetProgressBar();

                  if (state.progress) {
                    updateProgressBar(state.progress);
                    progressPercent.textContent = `${state.progress}%`;
                  }

                  // Restore other progress indicators if available
                  if (state.size) progressSize.textContent = state.size;
                  if (state.speed) progressSpeed.textContent = state.speed;
                  if (state.eta) progressEta.textContent = `ETA: ${state.eta}`;

                  // Determine appropriate status message
                  let statusMessage = "Resuming download...";
                  if (state.status === "processing") {
                    statusMessage =
                      "Processing video... This may take a moment";
                    progressStatus.classList.add("progress-processing");
                  }

                  updateProgressStatus(state.status, statusMessage);

                  // Reconnect to event source to get updated progress
                  connectToEventSource(state.taskId);
                }
              } else {
                // Download is no longer valid, clear saved state
                console.log(
                  "Saved download is no longer valid, clearing state"
                );
                localStorage.removeItem("downloadState");
              }
            })
            .catch((err) => {
              console.error("Error checking saved download status:", err);
              localStorage.removeItem("downloadState");
            });
        }
      }
    } catch (e) {
      console.error("Error restoring download state:", e);
      localStorage.removeItem("downloadState");
    }
  }

  // Call this function when page loads
  restoreDownloadState();

  // Save download state to localStorage
  function saveDownloadState(taskId, status, data = {}) {
    try {
      const state = {
        taskId: taskId,
        status: status,
        timestamp: Date.now(),
        ...data,
      };

      localStorage.setItem("downloadState", JSON.stringify(state));
    } catch (e) {
      console.error("Error saving download state:", e);
    }
  }

  // Clear download state from localStorage
  function clearDownloadState() {
    localStorage.removeItem("downloadState");
  }

  // Make sure the form submission is properly handled
  if (downloadForm) {
    downloadForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const videoUrl = videoUrlInput.value.trim();
      if (!videoUrl) {
        showError("Please enter a URL");
        return;
      }

      // Get the selected format option
      const formatOption = document.querySelector(
        'input[name="format"]:checked'
      ).value;

      // Hide previous results and errors
      resultElement.classList.add("hidden");
      statusElement.textContent = "";
      statusElement.className = "status";

      // Show progress container
      progressContainer.classList.remove("hidden");
      resetProgressBar();
      updateProgressStatus("starting", "Initializing download...");

      console.log(
        "Submitting download request for:",
        videoUrl,
        "Format:",
        formatOption
      );

      // Send request to server
      const formData = new FormData();
      formData.append("video_url", videoUrl);
      formData.append("format", formatOption);

      fetch("/download", {
        method: "POST",
        body: formData,
      })
        .then((response) => {
          if (!response.ok) {
            return response.json().then((data) => {
              throw new Error(data.error || "Failed to process download");
            });
          }
          return response.json();
        })
        .then((data) => {
          if (data.success) {
            console.log("Download initiated, connecting to progress stream...");

            // Store task ID
            activeTaskId = data.task_id;

            // Save initial state
            saveDownloadState(data.task_id, "starting", {
              videoUrl: videoUrl,
              format: formatOption,
            });

            // Connect to SSE endpoint to get progress updates
            connectToEventSource(data.task_id);
          } else {
            throw new Error(data.error || "Unknown error occurred");
          }
        })
        .catch((error) => {
          // Check if error is about requiring authentication
          if (
            error.message.includes("authentication") ||
            error.message.includes("cookies")
          ) {
            progressContainer.classList.add("hidden");
            pendingDownload = {
              url: videoUrl,
              format: formatOption,
            };
            openCookieModal();
          } else {
            showError(error.message);
            progressContainer.classList.add("hidden");
            clearDownloadState(); // Clear state on error
          }
        });
    });
  } else {
    console.error("Download form not found in the document");
  }

  // Make sure the download button works properly
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      console.log("Download button clicked, filename:", downloadFilename);
      if (downloadFilename) {
        window.location.href = `/get_file/${downloadFilename}`;

        // Update the download button to show that file will be deleted
        this.disabled = true;
        this.textContent = "File will auto-delete after download";
        this.style.opacity = "0.7";

        // Reenable button after 10 seconds in case download fails
        setTimeout(() => {
          this.disabled = false;
          this.textContent = "Download Again";
          this.style.opacity = "1";
        }, 10000);
      } else {
        console.error("No filename available for download");
        showError("No file available for download");
      }
    });
  } else {
    console.error("Download button not found in the document");
  }

  function connectToEventSource(taskId) {
    // Close any existing connection
    if (eventSource) {
      try {
        eventSource.close();
      } catch (e) {
        console.error("Error closing previous event source:", e);
      }
      eventSource = null;
    }

    console.log("Connecting to EventSource for task ID:", taskId);

    // Connect to the progress endpoint with a timestamp to prevent caching
    eventSource = new EventSource(`/progress/${taskId}?t=${Date.now()}`);

    // Set a flag to track if we've received any progress updates
    let receivedProgressUpdate = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;

    // If we don't get a progress update within 5 seconds, try reconnecting
    const progressTimeout = setTimeout(() => {
      if (
        !receivedProgressUpdate &&
        reconnectAttempts < MAX_RECONNECT_ATTEMPTS
      ) {
        console.warn(
          "No progress updates received after 5 seconds - attempting to reconnect"
        );

        reconnectAttempts++;

        // Close and reconnect
        const es = eventSource;
        eventSource = null;
        if (es) {
          try {
            es.close();
          } catch (e) {}
        }

        // Wait a moment and try reconnecting
        setTimeout(() => {
          connectToEventSource(taskId);
        }, 1000);
      }
    }, 5000);

    // Debug connection open event
    eventSource.onopen = function () {
      console.log("EventSource connection opened successfully");
    };

    eventSource.onmessage = function (event) {
      //console.log("Progress update received:", event.data);
      receivedProgressUpdate = true;
      clearTimeout(progressTimeout);

      try {
        const data = JSON.parse(event.data);

        //console.log("Parsed progress data:", data);

        if (data.status === "downloading") {
          // Update progress bar and percentage
          updateProgressBar(data.progress);
          progressPercent.textContent = `${data.progress}%`;

          // Update size display - strip any remaining ANSI codes
          if (data.size && data.size !== "unknown") {
            progressSize.textContent = stripAnsiCodes(data.size);
          } else {
            progressSize.textContent = "Calculating...";
          }

          // Update speed display - strip any remaining ANSI codes
          if (data.speed && data.speed !== "0 KiB/s") {
            progressSpeed.textContent = stripAnsiCodes(data.speed);
          } else {
            progressSpeed.textContent = "Calculating speed...";
          }

          // Update ETA display - strip any remaining ANSI codes
          if (data.eta && data.eta !== "unknown") {
            progressEta.textContent = `ETA: ${stripAnsiCodes(data.eta)}`;
          } else {
            progressEta.textContent = "ETA: calculating";
          }

          // Create a detailed status message - strip ANSI codes from all parts
          const statusMessage = `Downloading: ${
            data.progress
          }% of ${stripAnsiCodes(data.size)} at ${stripAnsiCodes(data.speed)}`;
          updateProgressStatus("downloading", statusMessage);

          // Save download state
          saveDownloadState(taskId, "downloading", {
            progress: data.progress,
            size: stripAnsiCodes(data.size),
            speed: stripAnsiCodes(data.speed),
            eta: stripAnsiCodes(data.eta),
          });

          // Force a redraw of the progress bar to ensure smooth updates
          setTimeout(() => {
            progressBar.style.transition = "width 0.3s ease-in-out";
          }, 10);
        } else if (data.status === "processing") {
          updateProgressBar(100);
          progressPercent.textContent = "100%";
          progressSpeed.textContent = "";
          progressEta.textContent = "";
          updateProgressStatus(
            "processing",
            "Processing video... This may take a moment"
          );
          progressStatus.classList.add("progress-processing");

          // Save download state
          saveDownloadState(taskId, "processing", {
            progress: 100,
          });
        } else if (data.status === "complete") {
          // Download complete
          updateProgressBar(100);
          progressPercent.textContent = "100%";
          progressStatus.classList.remove("progress-processing");
          updateProgressStatus("complete", "Download complete!");

          // Show download button after a short delay
          setTimeout(() => {
            // Save a reference to eventSource before setting it to null
            const es = eventSource;

            // First set eventSource to null to prevent further attempts to use it
            eventSource = null;

            // Then close the event source
            if (es) {
              try {
                es.close();
              } catch (e) {
                console.error("Error closing EventSource:", e);
              }
            }

            progressContainer.classList.add("hidden");

            // Update result elements
            videoTitleElement.textContent = `Title: ${data.title}`;

            let formatText = "";
            switch (data.format) {
              case "audio":
                formatText = "MP3 Audio";
                break;
              case "720p":
                formatText = "720p Video";
                break;
              case "1080p":
                formatText = "1080p Video";
                break;
              default:
                formatText = "Best Quality Video";
            }

            formatInfoElement.textContent = `Format: ${formatText}`;
            downloadFilename = data.download_path;
            console.log("Setting download filename:", downloadFilename);

            // Clear any existing file info notes
            const existingNotes =
              resultElement.querySelectorAll(".file-info-note");
            existingNotes.forEach((note) => note.remove());

            // Show original filename if available
            if (data.original_filename) {
              const filenameInfo = document.createElement("p");
              filenameInfo.className = "file-info";
              filenameInfo.innerHTML = `File: <span class="file-name">${data.original_filename}</span>`;
              resultElement
                .querySelector(".download-info")
                .appendChild(filenameInfo);
            }

            // Add note about automatic deletion
            const deleteNote = document.createElement("p");
            deleteNote.className = "file-info-note";
            deleteNote.innerHTML =
              '⚠️ <span class="note-text">File will be automatically deleted after download for privacy</span>';
            resultElement
              .querySelector(".download-info")
              .appendChild(deleteNote);

            resultElement.classList.remove("hidden");

            // Save download state
            saveDownloadState(taskId, "complete", {
              title: data.title,
              format: data.format,
              download_path: data.download_path,
              original_filename: data.original_filename,
            });
          }, 1000);
        } else if (data.status === "error") {
          // Error occurred
          console.error("Error in download:", data.message);

          // First save reference, then set to null
          const es = eventSource;
          eventSource = null;

          // Then close the event source
          if (es) {
            try {
              es.close();
            } catch (e) {
              console.error("Error closing EventSource:", e);
            }
          }

          progressContainer.classList.add("hidden");
          showError(data.message || "An error occurred during download");

          // Clear download state on error
          clearDownloadState();
        } else if (data.status === "starting") {
          // Starting status update
          updateProgressStatus("starting", "Preparing download...");

          // Save initial state
          saveDownloadState(taskId, "starting");
        }
      } catch (e) {
        console.error("Error parsing progress data:", e, event.data);
      }
    };

    eventSource.onerror = function (err) {
      console.error("EventSource error:", err);
      clearTimeout(progressTimeout);

      // If we've never received an update, try reconnecting
      if (
        !receivedProgressUpdate &&
        reconnectAttempts < MAX_RECONNECT_ATTEMPTS
      ) {
        console.log(
          "Connection error before receiving updates, attempting to reconnect..."
        );

        reconnectAttempts++;

        // Save reference before setting to null
        const es = eventSource;
        eventSource = null;

        // Close the connection if it exists
        if (es) {
          try {
            es.close();
          } catch (e) {}
        }

        // Wait a moment and try again
        setTimeout(() => {
          connectToEventSource(taskId);
        }, 1000);

        return;
      }

      // If we have a progress of 95% or more, try to check if the download completed
      const currentProgress =
        parseFloat(progressBar.style.width) ||
        parseFloat(progressPercent.textContent) ||
        0;

      if (currentProgress > 95) {
        console.log(
          "Connection closed but download might be complete, checking status..."
        );

        // Close the event source
        const es = eventSource;
        eventSource = null;
        if (es) {
          try {
            es.close();
          } catch (e) {}
        }

        // Check if the download completed despite the connection error
        fetch(`/check_status/${taskId}`)
          .then((response) => response.json())
          .then((data) => {
            if (data.success && data.download_path) {
              progressContainer.classList.add("hidden");
              updateProgressStatus("complete", "Download complete!");

              setTimeout(() => {
                resultElement.classList.remove("hidden");
                videoTitleElement.textContent = `Title: ${
                  data.title || "Downloaded Video"
                }`;

                let formatText = "";
                switch (data.format) {
                  case "audio":
                    formatText = "MP3 Audio";
                    break;
                  case "720p":
                    formatText = "720p Video";
                    break;
                  case "1080p":
                    formatText = "1080p Video";
                    break;
                  default:
                    formatText = "Video";
                }

                formatInfoElement.textContent = `Format: ${formatText}`;
                downloadFilename = data.download_path;

                // Add note about automatic deletion
                const deleteNote = document.createElement("p");
                deleteNote.className = "file-info-note";
                deleteNote.innerHTML =
                  '⚠️ <span class="note-text">File will be automatically deleted after download for privacy</span>';
                resultElement
                  .querySelector(".download-info")
                  .appendChild(deleteNote);

                // Show original filename if available
                if (data.original_filename) {
                  const filenameInfo = document.createElement("p");
                  filenameInfo.className = "file-info";
                  filenameInfo.innerHTML = `File: <span class="file-name">${data.original_filename}</span>`;
                  resultElement
                    .querySelector(".download-info")
                    .appendChild(filenameInfo);
                }

                // Save completed download state
                saveDownloadState(taskId, "complete", {
                  title: data.title || "Downloaded Video",
                  format: data.format,
                  download_path: data.download_path,
                  original_filename: data.original_filename,
                });
              }, 1000);
            } else {
              throw new Error("Download status could not be confirmed");
            }
          })
          .catch((err) => {
            console.error("Failed to verify download status:", err);
            updateProgressStatus(
              "error",
              "Connection lost. Try again or check downloads folder."
            );
            setTimeout(() => {
              progressContainer.classList.add("hidden");
            }, 3000);

            // Clear state on error
            clearDownloadState();
          });

        return;
      }

      // Otherwise, show an error
      const es = eventSource;
      eventSource = null;

      if (es) {
        try {
          es.close();
        } catch (e) {}
      }

      updateProgressStatus("error", "Connection lost. Please try again.");
      setTimeout(() => {
        progressContainer.classList.add("hidden");
      }, 3000);
    };
  }

  function resetProgressBar() {
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    progressSize.textContent = "Calculating...";
    progressSpeed.textContent = "0 KiB/s";
    progressEta.textContent = "ETA: calculating";
    progressStatus.textContent = "Preparing download...";
    progressStatus.className = "progress-status";
  }

  function updateProgressBar(percent) {
    progressBar.style.width = `${percent}%`;
  }

  function updateProgressStatus(status, message) {
    // Remove all status classes
    progressStatus.className = "progress-status";

    // Add status dot
    let statusHTML = "";

    switch (status) {
      case "starting":
        statusHTML = '<span class="status-dot"></span>';
        break;
      case "downloading":
        statusHTML = '<span class="status-dot downloading"></span>';
        break;
      case "processing":
        statusHTML = '<span class="status-dot processing"></span>';
        break;
      case "complete":
        statusHTML = '<span class="status-dot complete"></span>';
        break;
      case "error":
        statusHTML = '<span class="status-dot error"></span>';
        progressStatus.classList.add("error");
        break;
    }

    progressStatus.innerHTML = statusHTML + message;
  }

  // Extract cookies form submission
  if (extractCookiesForm) {
    extractCookiesForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const browser = document.getElementById("browserSelect").value;
      const statusMsg = document.createElement("p");
      statusMsg.textContent = `Extracting cookies from ${browser}...`;
      this.appendChild(statusMsg);

      const formData = new FormData();
      formData.append("browser", browser);

      fetch("/extract_cookies", {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            statusMsg.textContent = `✅ ${data.message}`;
            statusMsg.style.color = "green";

            // If there was a pending download, retry it
            if (pendingDownload) {
              setTimeout(() => {
                closeCookieModal();
                retryDownload();
              }, 1500);
            } else {
              setTimeout(() => {
                closeCookieModal();
                window.location.reload();
              }, 1500);
            }
          } else {
            statusMsg.textContent = `❌ ${data.error}`;
            statusMsg.style.color = "red";
          }
        })
        .catch((error) => {
          statusMsg.textContent = `❌ Error: ${error.message}`;
          statusMsg.style.color = "red";
        });
    });
  }

  // Upload cookies form submission
  if (uploadCookiesForm) {
    uploadCookiesForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const fileInput = document.getElementById("cookieFile");
      if (!fileInput.files || fileInput.files.length === 0) {
        showModalError(this, "Please select a cookie file");
        return;
      }

      const formData = new FormData();
      formData.append("cookie_file", fileInput.files[0]);

      const statusMsg = document.createElement("p");
      statusMsg.textContent = "Uploading cookies...";
      this.appendChild(statusMsg);

      fetch("/upload_cookies", {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            statusMsg.textContent = "✅ Cookies uploaded successfully";
            statusMsg.style.color = "green";

            // If there was a pending download, retry it
            if (pendingDownload) {
              setTimeout(() => {
                closeCookieModal();
                retryDownload();
              }, 1500);
            } else {
              setTimeout(() => {
                closeCookieModal();
                window.location.reload();
              }, 1500);
            }
          } else {
            statusMsg.textContent = `❌ ${data.error}`;
            statusMsg.style.color = "red";
          }
        })
        .catch((error) => {
          statusMsg.textContent = `❌ Error: ${error.message}`;
          statusMsg.style.color = "red";
        });
    });
  }

  // Manage cookies button click
  if (manageCookiesBtn) {
    manageCookiesBtn.addEventListener("click", function () {
      openCookieModal();
    });
  }

  // Close modal button
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeCookieModal();
    });
  }

  // Close modal when clicking outside
  window.addEventListener("click", function (e) {
    if (e.target === cookieModal) {
      closeCookieModal();
    }
  });

  function showError(message) {
    statusElement.textContent = `Error: ${message}`;
    statusElement.className = "status error";
    resultElement.classList.add("hidden");
  }

  function showModalError(formElement, message) {
    const errorMsg = document.createElement("p");
    errorMsg.textContent = message;
    errorMsg.style.color = "red";

    // Remove any existing error messages
    const existingErrors = formElement.querySelectorAll("p");
    existingErrors.forEach((el) => el.remove());

    formElement.appendChild(errorMsg);
  }

  function openCookieModal() {
    cookieModal.classList.remove("hidden");
  }

  function closeCookieModal() {
    cookieModal.classList.add("hidden");
  }

  function retryDownload() {
    if (pendingDownload) {
      // Reset UI
      progressContainer.classList.remove("hidden");
      resetProgressBar();
      updateProgressStatus(
        "starting",
        "Retrying download with authentication..."
      );

      // Hide previous results and errors
      resultElement.classList.add("hidden");
      statusElement.textContent = "";
      statusElement.className = "status";

      const formData = new FormData();
      formData.append("video_url", pendingDownload.url);
      formData.append("format", pendingDownload.format);

      fetch("/download", {
        method: "POST",
        body: formData,
      })
        .then((response) => {
          if (!response.ok) {
            return response.json().then((data) => {
              throw new Error(data.error || "Failed to process download");
            });
          }
          return response.json();
        })
        .then((data) => {
          if (data.success) {
            // Store task ID
            activeTaskId = data.task_id;

            // Save initial state
            saveDownloadState(data.task_id, "starting", {
              videoUrl: pendingDownload.url,
              format: pendingDownload.format,
            });

            // Clear pending download
            pendingDownload = null;

            // Connect to SSE endpoint to get progress updates
            connectToEventSource(data.task_id);
          } else {
            throw new Error(data.error || "Unknown error occurred");
          }
        })
        .catch((error) => {
          progressContainer.classList.add("hidden");
          showError(error.message);
          clearDownloadState();
        });
    }
  }

  // Add window event listener for beforeunload to handle browser navigation
  window.addEventListener("beforeunload", function (e) {
    // If there's an active download in progress, we could show a warning
    const savedState = localStorage.getItem("downloadState");
    if (savedState) {
      const state = JSON.parse(savedState);
      if (state.status === "downloading" || state.status === "processing") {
        // This shows a confirmation dialog in most browsers
        e.preventDefault();
        e.returnValue =
          "You have a download in progress. Are you sure you want to leave?";
        return e.returnValue;
      }
    }
  });

  // Cleanup old downloads periodically
  function cleanupDownloads() {
    // Run cleanup once an hour
    fetch("/cleanup", {
      method: "POST",
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          console.log(data.message);
        } else {
          console.error("Cleanup error:", data.error);
        }
      })
      .catch((error) => {
        console.error("Cleanup error:", error);
      });
  }

  // Run cleanup when page loads and then every hour
  cleanupDownloads();
  setInterval(cleanupDownloads, 60 * 60 * 1000); // Every hour

  // Validate URL as you type
  if (videoUrlInput) {
    videoUrlInput.addEventListener("input", function () {
      const url = this.value.trim();

      // Simple URL validation (checks for basic URL format)
      const urlRegex =
        /^(https?:\/\/)?((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|((\d{1,3}\.){3}\d{1,3}))(:\d+)?(\/[-a-z\d%_.~+]*)*(\?[;&a-z\d%_.~+=-]*)?(#[-a-z\d_]*)?$/i;

      if (url && !urlRegex.test(url)) {
        this.style.borderColor = "#ff6666";
      } else {
        this.style.borderColor = url ? "#66cc66" : "#ddd";
      }
    });
  }

  // Add some CSS for the file notes
  const style = document.createElement("style");
  style.textContent = `
    .file-info-note {
      margin-top: 10px;
      font-size: 13px;
      color: #666;
    }
    .note-text {
      font-style: italic;
    }
    .file-info {
      margin-top: 5px;
      font-size: 14px;
    }
    .file-name {
      font-family: monospace;
      background: #f5f5f5;
      padding: 2px 5px;
      border-radius: 3px;
    }
  `;
  document.head.appendChild(style);
});
