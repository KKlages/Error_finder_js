const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');
const path = require('path');

const app = express();
const upload = multer({ dest: os.tmpdir() });

// BPMN lint config
const BPMNLINT_CONFIG = {
  extends: "bpmnlint:recommended"
};

async function ensureConfig() {
  try {
    await fs.writeFile('.bpmnlintrc', JSON.stringify(BPMNLINT_CONFIG, null, 2));
    console.log('Created .bpmnlintrc configuration file');
  } catch (error) {
    console.error('Error creating config file:', error);
    throw error;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Validation endpoint
app.post('/validate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  if (!req.file.originalname.endsWith('.bpmn')) {
    await fs.unlink(req.file.path);
    return res.status(400).json({ error: 'Invalid file type. Only .bpmn files are allowed' });
  }

  try {
    // Ensure config exists
    await ensureConfig();

    // Run bpmnlint
    const { stdout, stderr } = await execPromise(`npx bpmnlint "${req.file.path}"`, {
      timeout: 30000 // 30 second timeout
    });

    // Clean up the temporary file
    await fs.unlink(req.file.path);

    // Process the result
    if (!stderr) {
      return res.json({ message: 'No errors found' });
    } else {
      return res.json({
        errors: stderr,
        details: stdout
      });
    }
  } catch (error) {
    // Clean up the temporary file in case of error
    try {
      await fs.unlink(req.file.path);
    } catch (unlinkError) {
      console.error('Error cleaning up temp file:', unlinkError);
    }

    // Handle timeout error
    if (error.code === 'ETIMEDOUT') {
      return res.status(408).json({ error: 'Validation timed out' });
    }

    console.error('Validation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
