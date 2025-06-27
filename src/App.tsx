import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./index.css";
import { Button } from "@/components/ui/button"

function App() {
  const [selectedFolder, setSelectedFolder] = useState("");

  async function selectFolder() {
    try {
      const folderPath = await open({
        directory: true,
        multiple: false,
      });
      
      if (folderPath) {
        setSelectedFolder(folderPath as string);
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <main className="container">
      <h1>Folder Explorer</h1>

      <div className="folder-selection">
        <Button onClick={selectFolder} className="folder-button">
          Select Folder
        </Button>
        
        {selectedFolder && (
          <div className="selected-folder">
            <h3>Selected Folder:</h3>
            <p className="folder-path">{selectedFolder}</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
