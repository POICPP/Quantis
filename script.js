document.addEventListener('DOMContentLoaded', () => {
  // --- IndexedDB Setup ---
  const DB_NAME = 'QuantisDataOS';
  const DB_VERSION = 1;
  const STORE_NAME = 'localFiles';
  let db;

  const initDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  };

  const saveFile = (file, profiles = []) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const fileData = {
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: Date.now(),
        blob: file,
        profiles: profiles
      };

      const request = store.add(fileData);
      
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  };

  const getAllFiles = () => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by newest first
        const files = request.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(files);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  };

  const clearAllFiles = () => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  };

  // --- UI Logic ---
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload-btn');
  const filesGrid = document.getElementById('files-grid');
  const storageInfo = document.getElementById('storage-info');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const uploadIcon = document.querySelector('.upload-icon');
  
  // Format bytes to human readable
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Determine icon based on file type
  const getFileIcon = (type, name) => {
    if (type.includes('pdf') || name.endsWith('.pdf')) return '<i class="ph ph-file-pdf" style="color: #ef4444"></i>';
    if (type.includes('csv') || name.endsWith('.csv') || type.includes('excel') || type.includes('spreadsheet')) return '<i class="ph ph-file-csv" style="color: #22c55e"></i>';
    if (type.includes('image')) return '<i class="ph ph-image" style="color: #3b82f6"></i>';
    if (type.includes('text') || name.endsWith('.txt')) return '<i class="ph ph-file-text" style="color: #a1a1aa"></i>';
    return '<i class="ph ph-file" style="color: #a1a1aa"></i>';
  };

  // Render the files grid
  const renderFiles = async () => {
    try {
      const files = await getAllFiles();
      storageInfo.textContent = `${files.length} file${files.length !== 1 ? 's' : ''} loaded in local repository`;
      
      if (files.length === 0) {
        filesGrid.innerHTML = `
          <div class="empty-state" id="empty-state">
            <i class="ph ph-hard-drives"></i>
            <p>Local repository empty. Ingest data to begin.</p>
          </div>
        `;
        return;
      }

      filesGrid.innerHTML = '';
      files.forEach(fileData => {
        const date = new Date(fileData.timestamp).toLocaleDateString() + ' ' + new Date(fileData.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const card = document.createElement('div');
        card.className = 'file-card';
        card.innerHTML = `
          <div class="file-type-icon">${getFileIcon(fileData.type, fileData.name)}</div>
          <div class="file-meta-info">
            <span class="file-card-name" title="${fileData.name}">${fileData.name}</span>
            <span class="file-card-size">${formatBytes(fileData.size)} • ${date}</span>
          </div>
          <div class="file-actions">
            <button class="view-btn" title="View Local File"><i class="ph ph-eye"></i></button>
          </div>
        `;

        // Handle View
        const viewBtn = card.querySelector('.view-btn');
        viewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = URL.createObjectURL(fileData.blob);
          window.open(url, '_blank');
          
          // Note: we don't immediately revoke the URL because the new tab needs time to load it.
          // Ideally, we'd revoke it later, but for a local prototype this is fine.
        });

        filesGrid.appendChild(card);
      });
    } catch (e) {
      console.error('Failed to render files', e);
    }
  };

  // Upload & AI Processing
  const processFiles = async (files) => {
    if (files.length === 0) return;

    const content = dropzone.querySelector('.dropzone-content');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    content.style.display = 'none';
    progressContainer.style.display = 'block';
    progressFill.style.width = '5%';
    
    let processed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progressText.textContent = `Analyzing ${file.name} via AI...`;
      
      let profilesResult = [];
      
      try {
        // Send to local Python backend
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('http://localhost:8000/analyze', {
          method: 'POST',
          body: formData
        });
        
        if (response.ok) {
          const data = await response.json();
          profilesResult = data.profiles || [];
        } else {
          console.warn("Backend returned an error. Ensure the Python server is running.");
        }
      } catch (e) {
        console.warn("Could not connect to AI backend. Make sure the FastAPI server is running on port 8000.", e);
      }
      
      // Save file and profiles array locally
      await saveFile(file, profilesResult);
      
      processed++;
      progressFill.style.width = `${5 + (95 * (processed / files.length))}%`;
    }

    setTimeout(() => {
      content.style.display = 'flex';
      progressContainer.style.display = 'none';
      progressFill.style.width = '0%';
      progressText.textContent = 'Processing data streams...';
      renderFiles(); // Update UI
    }, 500);
  };

  // --- Event Listeners ---
  uploadBtn.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', (e) => {
    processFiles(e.target.files);
    e.target.value = ''; // Reset
  });

  clearAllBtn.addEventListener('click', async () => {
    if(confirm('Warning: This will clear the local IndexedDB cache entirely. Proceed?')) {
      await clearAllFiles();
      renderFiles();
    }
  });

  // Drag & Drop
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    let dt = e.dataTransfer;
    let files = dt.files;
    processFiles(files);
  }, false);

  // Initialize App
  initDB().then(() => {
    renderFiles();
  }).catch(e => {
    console.error("Failed to initialize Quantis DB", e);
    storageInfo.textContent = "Error initializing Local Repository";
  });
});
