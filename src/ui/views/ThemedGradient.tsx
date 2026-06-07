import type React from "react";
import { Text, type TextProps } from "ink";
import Gradient from "ink-gradient";

const CYBERPUNK_GRADIENT = ["#06b6d4", "#229ac3", "#7b2fff"];

export const ThemedGradient: React.FC<TextProps> = ({ children, ...props }) => {
  return (
    <Gradient colors={CYBERPUNK_GRADIENT}>
      <Text {...props}>{children}</Text>
    </Gradient>
  );
};
