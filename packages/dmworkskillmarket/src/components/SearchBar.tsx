import React from "react";
import { Search } from "lucide-react";
import { WKInput } from "@octo/base";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export default function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  return (
    <WKInput
      size="md"
      value={value}
      onChange={onChange}
      prefix={<Search size={16} />}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}
