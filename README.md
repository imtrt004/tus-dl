# 🎬 TuS-DL: Universal Media Downloader

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-brightgreen)
![Flask](https://img.shields.io/badge/flask-2.0%2B-orange)
![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-red)

<p align="center">
  <img src="https://i.imgur.com/Ky9EwSB.png" alt="TuS-DL Logo" width="200"/>
</p>

## 🌟 Overview

**TuS-DL** is a powerful, user-friendly web application that lets you download videos, audio, and media from 1000+ websites including YouTube, Instagram, TikTok, Twitter, and many more. Built with Python Flask and yt-dlp, it provides a clean interface with real-time progress updates and flexible download options.

## ✨ Features

- 🌐 **Multi-site Support**: Download from 1000+ sites
- 📊 **Real-time Progress**: Live download progress with speed, ETA, and file size
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🎵 **Audio Extraction**: Download as MP3 audio
- 🎞️ **Quality Options**: Choose from multiple quality options (Best, 1080p, 720p)
- 🔐 **Cookie Management**: Automatic or manual cookie handling for authenticated downloads
- 🧹 **Auto Cleanup**: Files are deleted after download for privacy
- 🔄 **Resume Downloads**: Automatic recovery of interrupted downloads

## 🖥️ Screenshots

<p align="center">
  <img src="https://i.imgur.com/zY7xKzc.png" width="45%" />
  <img src="https://i.imgur.com/3GuhoR8.png" width="45%" />
</p>

## 🚀 Installation

### Prerequisites
- Python 3.10 or higher
- pip (Python package installer)
- FFmpeg (for media processing)

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/imtrt004/tus-dl.git
cd tus-dl

# Create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows, use: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the application
python app.py
```

Then visit `http://127.0.0.1:5000` in your browser.

## 🛠️ Development

Want to contribute? Great! Here's how to set up for development:

```bash
# Install development requirements
pip install -r dev-requirements.txt

# Run tests
pytest
```

## 📋 How It Works

1. Enter a URL from any supported site
2. Select your preferred format (Best quality, 1080p, 720p, or Audio)
3. Click "Download" and watch real-time progress
4. When complete, click "Download Now" to save the file

## 📚 API Reference

The application includes a simple API:

- `GET /api/supported_sites` - Returns list of all supported sites
- `POST /download` - Initiates a download
- `GET /progress/{task_id}` - SSE endpoint for progress updates
- `GET /get_file/{filename}` - Downloads a completed file

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please read CONTRIBUTING.md for details on our code of conduct and process.

## 🔧 Architecture

TuS-DL follows a clean modular architecture:

- **Frontend**: HTML, CSS, JavaScript with vanilla JS for minimal dependencies
- **Backend**: Flask Python web framework
- **Download Engine**: yt-dlp with custom progress hooks
- **Real-time Updates**: Server-Sent Events (SSE) for live progress
- **File Management**: Automatic cleanup and secure file handling

## 🌐 Supported Sites

TuS-DL supports over 1000 sites including:

- Video platforms (YouTube, Vimeo, Dailymotion)
- Social media (Instagram, TikTok, Twitter, Facebook)
- Music platforms (SoundCloud, Bandcamp)
- News sites, educational platforms, and much more

See the complete list on the [Supported Sites](http://127.0.0.1:5000/supported_sites) page.

## 🔍 Troubleshooting

### Common Issues

- **Download Fails**: Try using cookie extraction for sites requiring login
- **No Video Found**: The URL might be incorrect or the content might be private
- **Slow Downloads**: Try a different format or check your internet connection

### Getting Help

If you encounter any issues:
1. Check the [Issues](https://github.com/imtrt004/tus-dl/issues) page
2. Search for similar problems
3. Open a new issue with detailed reproduction steps

## 🔜 Roadmap

Features planned for future releases:

- [ ] Bulk download support
- [ ] Custom download queue management
- [ ] Playlist/channel batch processing
- [ ] Subtitles extraction options
- [ ] Advanced video trimming
- [ ] API key for programmatic access

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👏 Acknowledgements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - The powerful downloader that powers this app
- [Flask](https://flask.palletsprojects.com/) - The web framework used
- [Contributors](https://github.com/imtrt004/tus-dl/contributors) - All the amazing people who have contributed

## ⚠️ Disclaimer

This tool is for educational purposes only. Always respect copyright laws and terms of service for the content you download. Please use TuS-DL responsibly.

## 📬 Contact

Have questions? Reach out at [Telegram](https://t.me/im_trt)

## 💫 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=imtrt004/tus-dl&type=Date)](https://star-history.com/#imtrt004/tus-dl&Date)

---

<p align="center">
  Made with ❤️ by TuS-DL Team
</p>
