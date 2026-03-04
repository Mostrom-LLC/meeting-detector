// Simple Node.js example without TypeScript (works with just node)
const { spawn } = require('child_process');

class SimpleMeetingDetector {
  constructor() {
    this.process = null;
  }

  start(callback) {
    if (this.process) {
      throw new Error('Detector is already running');
    }

    console.log('🔍 Starting meeting detector...');
    
    this.process = spawn('sh', ['./meeting-detect.sh'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const signal = JSON.parse(line);
            // Convert camera_active string to boolean
            signal.camera_active = signal.camera_active === 'true';
            callback(signal);
          } catch (error) {
            console.error('Failed to parse signal:', line);
          }
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      console.log('stderr:', data.toString());
    });

    this.process.on('error', (error) => {
      console.error('Process error:', error);
    });

    this.process.on('exit', (code) => {
      console.log(`Process exited with code ${code}`);
      this.process = null;
    });
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      console.log('⏹️  Stopped monitoring');
    }
  }
}

// Usage example
const detector = new SimpleMeetingDetector();

detector.start((stateChange) => {
  console.log('📱 Meeting signal:', {
    app: stateChange.process,
    service: stateChange.service, 
    pid: stateChange.pid,
    front_app: stateChange.front_app,
    camera_active: stateChange.camera_active,
    timestamp: stateChange.timestamp
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down...');
  detector.stop();
  process.exit(0);
});

module.exports = { SimpleMeetingDetector };