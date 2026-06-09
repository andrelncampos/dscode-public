import React from "react";
import { AppContext, RawModeProvider, AppStateProvider } from "../contexts";
import App from "./App";

const AppContainer: React.FC<{
  projectRoot: string;
  version: string;
  initialPrompt: string | undefined;
  onRestart: () => void;
}> = ({ version, projectRoot, initialPrompt, onRestart }) => {
  return (
    <AppContext.Provider value={{ version: version }}>
      <RawModeProvider>
        <AppStateProvider projectRoot={projectRoot} initialPrompt={initialPrompt}>
          <App onRestart={onRestart} />
        </AppStateProvider>
      </RawModeProvider>
    </AppContext.Provider>
  );
};

export default AppContainer;
