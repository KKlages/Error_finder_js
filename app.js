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

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/validate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  if (!req.file.originalname.endsWith('.bpmn')) {
    await fs.unlink(req.file.path);
    return res.status(400).json({ error: 'Invalid file type. Only .bpmn files are allowed' });
  }

  try {
    await ensureConfig();

    try {
      const { stdout, stderr } = await execPromise(`npx bpmnlint "${req.file.path}"`, {
        timeout: 30000
      });
      
      // Clean up the temporary file
      await fs.unlink(req.file.path);

      // Parse the validation results
      const lines = stdout.split('\n').filter(line => line.trim());
      const problems = lines
        .filter(line => line.includes('error') || line.includes('warning'))
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            element: parts[0],
            type: parts[1],
            message: parts.slice(2, -1).join(' '),
            rule: parts[parts.length - 1]
          };
        });

      // Get the summary line if it exists
      const summary = lines.find(line => line.includes('problems'));

      return res.json({
        status: problems.length > 0 ? 'validation_issues' : 'success',
        problems,
        summary: summary || 'No issues found'
      });

    } catch (error) {
      // If we have stdout with validation results, this is not a real error
      if (error.stdout && (error.stdout.includes('error') || error.stdout.includes('warning'))) {
        const lines = error.stdout.split('\n').filter(line => line.trim());
        const problems = lines
          .filter(line => line.includes('error') || line.includes('warning'))
          .map(line => {
            const parts = line.trim().split(/\s+/);
            return {
              element: parts[0],
              type: parts[1],
              message: parts.slice(2, -1).join(' '),
              rule: parts[parts.length - 1]
            };
          });

        const summary = lines.find(line => line.includes('problems'));

        return res.json({
          status: 'validation_issues',
          problems,
          summary
        });
      }
      
      // If we get here, it's a real error
      throw error;
    }

  } catch (error) {
    // Clean up the temporary file in case of error
    try {
      await fs.unlink(req.file.path);
    } catch (unlinkError) {
      console.error('Error cleaning up temp file:', unlinkError);
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(408).json({ error: 'Validation timed out' });
    }

    return res.status(500).json({
      error: 'Validation failed',
      details: 'An unexpected error occurred during validation',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});